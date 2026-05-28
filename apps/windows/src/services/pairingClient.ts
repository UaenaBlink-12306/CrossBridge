import type {
  DeviceIdentity,
  PairingCompleteMessage,
  PairingExpiredMessage,
  PairingJoinedMessage,
  PairingQrPayload,
  PairingSessionCreatedMessage,
  PairingViewState,
  TrustedDevice
} from "../types/pairing.js";
import { loadOrCreateWindowsIdentity } from "./identityStore.js";
import { RelayClient } from "./relayClient.js";
import { saveTrustedDevice } from "./trustedDeviceStore.js";

type PairingStateHandler = (state: PairingViewState) => void;

const RELAY_HELLO_TIMEOUT_MS = 8_000;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function randomToken(prefix: string, byteLength = 18): string {
  return `${prefix}_${bytesToBase64(randomBytes(byteLength))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeviceIdentity(value: unknown): value is DeviceIdentity {
  return isRecord(value) &&
    typeof value.deviceId === "string" &&
    typeof value.deviceName === "string" &&
    (value.platform === "windows" || value.platform === "android") &&
    typeof value.publicKey === "string";
}

function isQrPayload(value: unknown): value is PairingQrPayload {
  return isRecord(value) &&
    value.protocol === "crossbridge-v1" &&
    typeof value.pairingSessionId === "string" &&
    typeof value.relayUrl === "string" &&
    typeof value.pcDeviceId === "string" &&
    typeof value.pcDeviceName === "string" &&
    typeof value.pcPublicKey === "string" &&
    typeof value.pairingToken === "string" &&
    typeof value.expiresAt === "number";
}

function isTrustedDevice(value: unknown): value is TrustedDevice {
  if (!isRecord(value) || !isDeviceIdentity(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.pairedAt === "number" &&
    (record.lastSeenAt === undefined || typeof record.lastSeenAt === "number");
}

function isMessageOfType<TType extends string>(
  message: unknown,
  type: TType
): message is { type: TType; payload?: unknown } {
  return isRecord(message) && message.type === type;
}

function isSessionCreatedMessage(message: unknown): message is PairingSessionCreatedMessage {
  return isMessageOfType(message, "PAIRING_SESSION_CREATED") &&
    isRecord(message.payload) &&
    isQrPayload(message.payload.qrPayload);
}

function isJoinedMessage(message: unknown): message is PairingJoinedMessage {
  return isMessageOfType(message, "PAIRING_JOINED") &&
    isRecord(message.payload) &&
    typeof message.payload.pairingSessionId === "string" &&
    isDeviceIdentity(message.payload.pcIdentity) &&
    isDeviceIdentity(message.payload.androidIdentity) &&
    typeof message.payload.verificationCode === "string";
}

function isCompleteMessage(message: unknown): message is PairingCompleteMessage {
  return isMessageOfType(message, "PAIRING_COMPLETE") &&
    isRecord(message.payload) &&
    typeof message.payload.pairingSessionId === "string" &&
    Array.isArray(message.payload.trustedDevices) &&
    message.payload.trustedDevices.every(isTrustedDevice);
}

function isExpiredMessage(message: unknown): message is PairingExpiredMessage {
  return isMessageOfType(message, "PAIRING_EXPIRED") &&
    isRecord(message.payload) &&
    typeof message.payload.pairingSessionId === "string" &&
    typeof message.payload.expiresAt === "number";
}

function isRelayWelcome(message: unknown, deviceId: string): boolean {
  return isRecord(message) &&
    message.type === "RELAY_WELCOME" &&
    message.deviceId === deviceId &&
    message.protocolVersion === 1;
}

function isRelayError(message: unknown): message is { type: "RELAY_ERROR"; message: string } {
  return isRecord(message) &&
    message.type === "RELAY_ERROR" &&
    typeof message.message === "string";
}

export class PairingClient {
  private readonly relayClient: RelayClient;
  private readonly unsubscribeRelayMessages: () => void;
  private readonly unsubscribeRelayState: () => void;
  private readonly handlers = new Set<PairingStateHandler>();
  private pcIdentity?: DeviceIdentity;
  private state: PairingViewState;
  private currentPairingSessionId?: string;
  private pendingQrRelayUrl?: string;
  private relayWelcomeResolver?: () => void;
  private relayWelcomeRejecter?: (error: Error) => void;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(relayClient = new RelayClient()) {
    this.relayClient = relayClient;
    this.state = {
      state: "idle",
      relayConnected: false,
      relayConnectionState: "disconnected"
    };
    this.unsubscribeRelayMessages = this.relayClient.onMessage((message) => {
      this.handleRelayMessage(message);
    });
    this.unsubscribeRelayState = this.relayClient.onStateChange((relayState) => {
      this.updateState({
        relayConnected: relayState === "connected",
        relayConnectionState: relayState
      });
    });
  }

  getState(): PairingViewState {
    return this.state;
  }

  onStateChange(handler: PairingStateHandler): () => void {
    this.handlers.add(handler);
    handler(this.state);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async createPairingSession(relayUrl: string, qrRelayUrl?: string): Promise<void> {
    this.clearExpiryTimer();
    this.currentPairingSessionId = undefined;
    this.pendingQrRelayUrl = qrRelayUrl?.trim() || undefined;
    this.updateState({
      state: "connecting",
      relayConnected: false,
      qrPayload: undefined,
      verificationCode: undefined,
      androidIdentity: undefined,
      trustedAndroidDevice: undefined,
      error: undefined,
      expiresAt: undefined
    });

    try {
      const pcIdentity = await this.ensureWindowsIdentity();
      await this.relayClient.connect(relayUrl.trim());
      await this.sendRelayHello(pcIdentity);
      this.relayClient.send({
        type: "PAIRING_SESSION_CREATE",
        payload: {
          deviceIdentity: pcIdentity
        }
      });
    } catch (error) {
      this.updateState({
        state: "error",
        error: error instanceof Error ? error.message : "Could not create pairing session."
      });
    }
  }

  confirmPairing(): void {
    if (!this.currentPairingSessionId || !this.pcIdentity) return;
    try {
      this.relayClient.send({
        type: "PAIRING_CONFIRM",
        payload: {
          pairingSessionId: this.currentPairingSessionId,
          deviceId: this.pcIdentity.deviceId
        }
      });
      this.updateState({ state: "confirmed", error: undefined });
    } catch (error) {
      this.updateState({
        state: "error",
        error: error instanceof Error ? error.message : "Could not confirm pairing."
      });
    }
  }

  disconnect(): void {
    this.clearExpiryTimer();
    this.relayClient.disconnect();
  }

  dispose(): void {
    this.disconnect();
    this.unsubscribeRelayMessages();
    this.unsubscribeRelayState();
    this.handlers.clear();
  }

  private async ensureWindowsIdentity(): Promise<DeviceIdentity> {
    if (this.pcIdentity) return this.pcIdentity;
    const identity = await loadOrCreateWindowsIdentity();
    this.pcIdentity = identity;
    this.updateState({ pcIdentity: identity });
    return identity;
  }

  private sendRelayHello(pcIdentity: DeviceIdentity): Promise<void> {
    this.relayClient.send({
      type: "RELAY_HELLO",
      deviceId: pcIdentity.deviceId,
      sessionToken: randomToken("session", 18),
      protocolVersion: 1
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.relayWelcomeResolver = undefined;
        this.relayWelcomeRejecter = undefined;
        reject(new Error("Relay did not acknowledge this Windows device."));
      }, RELAY_HELLO_TIMEOUT_MS);

      this.relayWelcomeResolver = () => {
        clearTimeout(timeout);
        this.relayWelcomeResolver = undefined;
        this.relayWelcomeRejecter = undefined;
        resolve();
      };
      this.relayWelcomeRejecter = (error) => {
        clearTimeout(timeout);
        this.relayWelcomeResolver = undefined;
        this.relayWelcomeRejecter = undefined;
        reject(error);
      };
    });
  }

  private handleRelayMessage(message: unknown): void {
    if (this.pcIdentity && isRelayWelcome(message, this.pcIdentity.deviceId)) {
      this.relayWelcomeResolver?.();
      return;
    }

    if (isRelayError(message)) {
      this.relayWelcomeRejecter?.(new Error(message.message));
      this.updateState({ state: "error", error: message.message });
      return;
    }

    if (isSessionCreatedMessage(message)) {
      const qrPayload = this.pendingQrRelayUrl
        ? { ...message.payload.qrPayload, relayUrl: this.pendingQrRelayUrl }
        : message.payload.qrPayload;
      this.currentPairingSessionId = qrPayload.pairingSessionId;
      this.scheduleExpiry(qrPayload);
      this.updateState({
        state: "waiting_for_android",
        qrPayload,
        expiresAt: qrPayload.expiresAt,
        error: undefined
      });
      return;
    }

    if (isJoinedMessage(message) && message.payload.pairingSessionId === this.currentPairingSessionId) {
      this.updateState({
        state: "waiting_for_confirmation",
        androidIdentity: message.payload.androidIdentity,
        verificationCode: message.payload.verificationCode,
        error: undefined
      });
      return;
    }

    if (isCompleteMessage(message) && message.payload.pairingSessionId === this.currentPairingSessionId) {
      this.clearExpiryTimer();
      void this.saveCompletedTrustedAndroidDevice(message.payload.trustedDevices);
      return;
    }

    if (isExpiredMessage(message) && message.payload.pairingSessionId === this.currentPairingSessionId) {
      this.clearExpiryTimer();
      this.updateState({
        state: "expired",
        expiresAt: message.payload.expiresAt
      });
    }
  }

  private async saveCompletedTrustedAndroidDevice(trustedDevices: TrustedDevice[]): Promise<void> {
    if (!this.pcIdentity) {
      this.updateState({
        state: "error",
        error: "Windows identity was not available when pairing completed."
      });
      return;
    }

    const trustedAndroidDevice = trustedDevices.find((device) => {
      return device.platform === "android" &&
        device.deviceId !== this.pcIdentity?.deviceId;
    });

    if (trustedAndroidDevice) {
      const deviceWithLastSeen = {
        ...trustedAndroidDevice,
        lastSeenAt: trustedAndroidDevice.lastSeenAt ?? Date.now()
      };
      try {
        await saveTrustedDevice(deviceWithLastSeen);
        this.updateState({
          state: "complete",
          trustedAndroidDevice: deviceWithLastSeen,
          error: undefined
        });
      } catch (error) {
        this.updateState({
          state: "error",
          error: error instanceof Error
            ? error.message
            : "Pairing completed, but the trusted device could not be saved."
        });
      }
    } else {
      this.updateState({
        state: "complete",
        error: undefined
      });
    }
  }

  private scheduleExpiry(qrPayload: PairingQrPayload): void {
    this.clearExpiryTimer();
    const delayMs = Math.max(0, qrPayload.expiresAt - Date.now());
    this.expiryTimer = setTimeout(() => {
      if (this.currentPairingSessionId !== qrPayload.pairingSessionId) return;
      if (this.state.state === "complete" || this.state.state === "confirmed") return;
      this.updateState({ state: "expired", expiresAt: qrPayload.expiresAt });
    }, delayMs);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  private updateState(nextState: Partial<PairingViewState>): void {
    this.state = {
      ...this.state,
      ...nextState
    };
    for (const handler of this.handlers) {
      handler(this.state);
    }
  }
}
