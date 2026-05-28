import {
  MessageType,
  TrustedDeviceOfflineMessageSchema,
  TrustedDeviceOnlineMessageSchema,
  TrustedDeviceStatusMessageSchema,
  type DeviceIdentity,
  type TrustedDevice,
  type FileOfferPayload,
  type FileAcceptPayload,
  type FileRejectPayload,
  type FileChunkPayload,
  type FileCompletePayload,
  type FileCancelPayload
} from "@crossbridge/protocol";
import { loadOrCreateWindowsCryptoIdentity, loadOrCreateWindowsIdentity } from "./identityStore.js";
import { RelayClient, type RelayConnectionState } from "./relayClient.js";
import {
  loadTrustedDevices,
  removeTrustedDevice,
  saveTrustedDevice,
  TRUSTED_DEVICES_CHANGED_EVENT
} from "./trustedDeviceStore.js";
import {
  createTextShareAckEnvelope,
  createTextShareEnvelope,
  decodeShareEnvelope,
  isRelayAck,
  relayAckFailureMessage
} from "./shareClient.js";
import { isTauriRuntime, invokeTauriCommand } from "./nativeBridge.js";
import { createLanDiscoveryProbeEnvelope, decodeLanDiscoveryProbeEnvelope } from "./lanDiscoveryClient.js";
import {
  addReceivedShare,
  addSendingShare,
  createEmptyShareHistory,
  markShareFailed,
  markShareReceived,
  markShareSent,
  type ReceivedShare,
  type SentShare
} from "./shareStore.js";
import {
  createNotificationDismissEnvelope,
  createNotificationReplyEnvelope,
  decodeNotificationEnvelope
} from "./notificationClient.js";
import {
  createEmptyNotificationHistory,
  markMirroredNotificationDismissFailed,
  markMirroredNotificationDismissSending,
  markMirroredNotificationReplyFailed,
  markMirroredNotificationReplySending,
  markMirroredNotificationReplySent,
  removeMirroredNotification,
  upsertMirroredNotification,
  type MirroredNotification
} from "./notificationStore.js";
import { ReplayProtector } from "./replayProtection.js";
import {
  createFileAcceptEnvelope,
  createFileCancelEnvelope,
  createFileChunkEnvelope,
  createFileCompleteEnvelope,
  createFileOfferEnvelope,
  createFileProgressEnvelope,
  createFileRejectEnvelope,
  decodeFileTransferEnvelope,
  inferRiskyFileWarning,
  reassembleTransferredFile,
  splitIntoFileChunks,
  type FileChunkDescriptor
} from "./fileTransferClient.js";

export type ConnectionPhase =
  | "not_paired"
  | "disconnected"
  | "connecting"
  | "connected_to_relay"
  | "trusted_device_online"
  | "trusted_device_offline"
  | "reconnecting"
  | "error";

export interface TrustedDeviceConnection {
  device: TrustedDevice;
  online: boolean;
  connectionMode?: "relay" | "lan";
  lastSeenAt?: number;
  localFastPathAvailable?: boolean;
}

export interface FileTransferState {
  transferId: string;
  peerDeviceId: string;
  fileName: string;
  fileSize: number;
  direction: "WINDOWS_TO_ANDROID" | "ANDROID_TO_WINDOWS";
  bytesTransferred: number;
  status: "offered" | "accepted" | "rejected" | "transferring" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string;
  riskyWarning?: string;
  sha256: string;
  mimeType?: string;
  speed?: number;
}

export interface ConnectionViewState {
  phase: ConnectionPhase;
  relayConnectionState: RelayConnectionState;
  relayUrl: string;
  windowsIdentity?: DeviceIdentity;
  trustedDevices: TrustedDeviceConnection[];
  sentShares: SentShare[];
  receivedShares: ReceivedShare[];
  transfers: FileTransferState[];
  notifications: MirroredNotification[];
  error?: string;
  shareError?: string;
}

type StateHandler = (state: ConnectionViewState) => void;

const DEFAULT_RELAY_URL = import.meta.env.VITE_CROSSBRIDGE_RELAY_URL ?? "ws://127.0.0.1:8787/connect";
const RELAY_URL_STORAGE_KEY = "crossbridge.relayUrl.v1";

function getStoredRelayUrl(): string {
  try {
    const stored = globalThis.localStorage?.getItem(RELAY_URL_STORAGE_KEY)?.trim();
    return stored || DEFAULT_RELAY_URL;
  } catch {
    return DEFAULT_RELAY_URL;
  }
}

function storeRelayUrl(relayUrl: string): void {
  try {
    globalThis.localStorage?.setItem(RELAY_URL_STORAGE_KEY, relayUrl);
  } catch {
    // Development storage can be unavailable in browser privacy modes.
  }
}

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

function phaseFor(
  relayConnectionState: RelayConnectionState,
  trustedDevices: TrustedDeviceConnection[],
  error?: string
): ConnectionPhase {
  if (error || relayConnectionState === "error") return "error";
  if (trustedDevices.length === 0) return "not_paired";
  if (relayConnectionState === "connecting") return "connecting";
  if (relayConnectionState === "reconnecting") return "reconnecting";
  if (relayConnectionState === "disconnected") return "disconnected";
  if (trustedDevices.some((device) => device.online)) return "trusted_device_online";
  return "trusted_device_offline";
}

export function createTrustedDeviceConnections(
  devices: TrustedDevice[]
): TrustedDeviceConnection[] {
  return devices.map((device) => ({
    device,
    online: false,
    lastSeenAt: device.lastSeenAt
  }));
}

export function applyTrustedDeviceOnline(
  devices: TrustedDeviceConnection[],
  deviceIdentity: DeviceIdentity,
  timestamp: number
): TrustedDeviceConnection[] {
  return devices.map((entry) => {
    if (entry.device.deviceId !== deviceIdentity.deviceId) return entry;
    return {
      device: {
        ...entry.device,
        deviceName: deviceIdentity.deviceName,
        platform: deviceIdentity.platform,
        publicKey: deviceIdentity.publicKey,
        lastSeenAt: timestamp
      },
      online: true,
      connectionMode: entry.localFastPathAvailable ? "lan" : "relay",
      lastSeenAt: timestamp,
      localFastPathAvailable: entry.localFastPathAvailable
    };
  });
}

export function applyTrustedDeviceOffline(
  devices: TrustedDeviceConnection[],
  deviceId: string,
  timestamp: number
): TrustedDeviceConnection[] {
  return devices.map((entry) => {
    if (entry.device.deviceId !== deviceId) return entry;
    return {
      ...entry,
      online: false,
      connectionMode: undefined,
      localFastPathAvailable: false,
      device: {
        ...entry.device,
        lastSeenAt: timestamp
      },
      lastSeenAt: timestamp
    };
  });
}

export function applyTrustedDeviceStatus(
  devices: TrustedDeviceConnection[],
  deviceId: string,
  online: boolean,
  lastSeenAt: number
): TrustedDeviceConnection[] {
  return devices.map((entry) => {
    if (entry.device.deviceId !== deviceId) return entry;
    const fastPath = online ? entry.localFastPathAvailable : false;
    return {
      ...entry,
      online,
      connectionMode: online ? (fastPath ? "lan" : "relay") : undefined,
      localFastPathAvailable: fastPath,
      device: {
        ...entry.device,
        lastSeenAt
      },
      lastSeenAt
    };
  });
}

export class ConnectionManager {
  private readonly relayClient: RelayClient;
  private readonly unsubscribeRelayMessages: () => void;
  private readonly unsubscribeRelayState: () => void;
  private readonly replayProtector = new ReplayProtector();
  private readonly handlers = new Set<StateHandler>();
  private readonly activeFileTransfers = new Map<string, { bytes: Uint8Array; chunks: FileChunkDescriptor[] }>();
  private readonly receivedChunks = new Map<string, FileChunkPayload[]>();
  private readonly pendingNotificationDismissals = new Map<
    string,
    { sourceDeviceId: string; notificationId: string }
  >();
  private readonly pendingNotificationReplies = new Map<
    string,
    { sourceDeviceId: string; notificationId: string; actionId: string }
  >();
  private trustedDevicesChangedHandler?: () => void;
  private state: ConnectionViewState;
  private readonly lanConnectedReceivers = new Set<string>();

  constructor(relayClient = new RelayClient()) {
    this.relayClient = relayClient;
    this.state = {
      phase: "disconnected",
      relayConnectionState: "disconnected",
      relayUrl: getStoredRelayUrl(),
      trustedDevices: [],
      transfers: [],
      ...createEmptyShareHistory(),
      ...createEmptyNotificationHistory()
    };

    this.unsubscribeRelayMessages = this.relayClient.onMessage((message) => {
      void this.handleRelayMessage(message);
    });
    this.unsubscribeRelayState = this.relayClient.onStateChange((relayConnectionState) => {
      this.handleRelayState(relayConnectionState);
    });

    if (typeof window !== "undefined") {
      this.trustedDevicesChangedHandler = () => {
        void this.refreshTrustedDevices();
      };
      window.addEventListener(TRUSTED_DEVICES_CHANGED_EVENT, this.trustedDevicesChangedHandler);
      window.addEventListener("storage", this.trustedDevicesChangedHandler);
    }

    if (isTauriRuntime()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        void listen("lan-chunk-received", (event) => {
          void this.handleRelayMessage(event.payload);
        });
        void listen("lan-receiver-connected", (event) => {
          const transferId = event.payload as string;
          this.lanConnectedReceivers.add(transferId);
        });
      }).catch((err) => {
        console.error("Failed to load Tauri event API:", err);
      });
    }
  }

  getState(): ConnectionViewState {
    return this.state;
  }

  onStateChange(handler: StateHandler): () => void {
    this.handlers.add(handler);
    handler(this.state);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(): Promise<void> {
    await this.refreshTrustedDevices();
  }

  async setRelayUrl(relayUrl: string): Promise<void> {
    const trimmedRelayUrl = relayUrl.trim();
    this.updateState({ relayUrl: trimmedRelayUrl, error: undefined });
    storeRelayUrl(trimmedRelayUrl);
  }

  async reconnectNow(): Promise<void> {
    await this.connectIfTrusted(true);
  }

  async removeTrustedDevice(deviceId: string): Promise<void> {
    await removeTrustedDevice(deviceId);
    await this.refreshTrustedDevices();
  }

  async dismissNotification(sourceDeviceId: string, notificationId: string): Promise<void> {
    const notification = this.state.notifications.find(
      (item) =>
        item.sourceDevice.deviceId === sourceDeviceId &&
        item.notificationId === notificationId
    );
    if (!notification) return;

    if (!notification.canDismiss) {
      this.updateState({
        notifications: markMirroredNotificationDismissFailed(
          this.state,
          sourceDeviceId,
          notificationId,
          "Android reports that this notification cannot be dismissed."
        ).notifications
      });
      return;
    }

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === sourceDeviceId);
    if (!target) {
      this.updateState({
        notifications: markMirroredNotificationDismissFailed(
          this.state,
          sourceDeviceId,
          notificationId,
          "That Android device is no longer trusted."
        ).notifications
      });
      return;
    }

    if (!target.online || this.state.relayConnectionState !== "connected") {
      this.updateState({
        notifications: markMirroredNotificationDismissFailed(
          this.state,
          sourceDeviceId,
          notificationId,
          "Failed to send because the phone is offline."
        ).notifications
      });
      return;
    }

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const envelope = await createNotificationDismissEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId: sourceDeviceId,
        payload: { notificationId },
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      this.pendingNotificationDismissals.set(envelope.messageId, {
        sourceDeviceId,
        notificationId
      });

      this.updateState({
        windowsIdentity,
        notifications: markMirroredNotificationDismissSending(
          this.state,
          sourceDeviceId,
          notificationId
        ).notifications
      });

      this.relayClient.send(envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send the dismiss request.";
      this.setNotificationDismissFailure(sourceDeviceId, notificationId, message);
    }
  }

  async sendNotificationReply(
    sourceDeviceId: string,
    notificationId: string,
    actionId: string,
    replyText: string
  ): Promise<void> {
    const notification = this.state.notifications.find(
      (item) =>
        item.sourceDevice.deviceId === sourceDeviceId &&
        item.notificationId === notificationId
    );
    if (!notification) return;

    const replyAction = notification.actions.find(
      (action) => action.actionId === actionId && action.supportsRemoteInput
    );
    if (!replyAction) {
      this.setNotificationReplyFailure(
        sourceDeviceId,
        notificationId,
        "Android no longer exposes a reply action for this notification."
      );
      return;
    }

    const trimmedReply = replyText.trim();
    if (!trimmedReply) {
      this.setNotificationReplyFailure(
        sourceDeviceId,
        notificationId,
        "Type a reply before sending it to the phone."
      );
      return;
    }

    if (trimmedReply.length > 4_096) {
      this.setNotificationReplyFailure(
        sourceDeviceId,
        notificationId,
        "Replies can be up to 4096 characters."
      );
      return;
    }

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === sourceDeviceId);
    if (!target) {
      this.setNotificationReplyFailure(
        sourceDeviceId,
        notificationId,
        "That Android device is no longer trusted."
      );
      return;
    }

    if (!target.online || this.state.relayConnectionState !== "connected") {
      this.setNotificationReplyFailure(
        sourceDeviceId,
        notificationId,
        "Failed to send because the phone is offline."
      );
      return;
    }

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const envelope = await createNotificationReplyEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId: sourceDeviceId,
        payload: {
          notificationId,
          actionId,
          replyText: trimmedReply
        },
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      this.pendingNotificationReplies.set(envelope.messageId, {
        sourceDeviceId,
        notificationId,
        actionId
      });

      this.updateState({
        windowsIdentity,
        notifications: markMirroredNotificationReplySending(
          this.state,
          sourceDeviceId,
          notificationId
        ).notifications
      });

      this.relayClient.send(envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send the reply request.";
      this.setNotificationReplyFailure(sourceDeviceId, notificationId, message);
    }
  }

  async sendTextShare(toDeviceId: string, text: string): Promise<void> {
    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === toDeviceId);
    if (!target) {
      this.updateState({ shareError: "Failed to send because the device is not trusted yet." });
      return;
    }

    if (!target.online || this.state.relayConnectionState !== "connected") {
      this.updateState({ shareError: "Failed to send because the device is offline." });
      return;
    }

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const created = createTextShareEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId,
        text,
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });
      const encrypted = await created;

      this.updateState({
        windowsIdentity,
        sentShares: addSendingShare(this.state, {
          shareId: encrypted.payload.shareId,
          messageId: encrypted.envelope.messageId,
          targetDevice: target.device,
          contentType: encrypted.payload.contentType,
          text: encrypted.payload.text,
          createdAt: encrypted.payload.createdAt
        }).sentShares,
        shareError: undefined
      });

      this.relayClient.send(encrypted.envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send through the relay.";
      this.updateState({
        sentShares: markMostRecentSendingShareFailed(this.state.sentShares, message),
        shareError: message
      });
    }
  }

  async sendFileOffer(toDeviceId: string, fileName: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === toDeviceId);
    if (!target) {
      const message = "Failed to send because the device is not trusted yet.";
      this.updateState({ shareError: message });
      throw new Error(message);
    }

    if (!target.online || this.state.relayConnectionState !== "connected") {
      const message = "Failed to send because the device is offline.";
      this.updateState({ shareError: message });
      throw new Error(message);
    }

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const created = await createFileOfferEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId,
        fileName,
        mimeType,
        bytes,
        direction: "WINDOWS_TO_ANDROID",
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      const transferState: FileTransferState = {
        transferId: created.transferId,
        peerDeviceId: toDeviceId,
        fileName,
        fileSize: bytes.length,
        direction: "WINDOWS_TO_ANDROID",
        bytesTransferred: 0,
        status: "offered",
        progress: 0,
        riskyWarning: created.riskyWarning,
        sha256: created.payload.sha256,
        mimeType
      };

      this.activeFileTransfers.set(created.transferId, {
        bytes,
        chunks: created.chunks
      });

      this.updateState({
        windowsIdentity,
        transfers: [transferState, ...this.state.transfers].slice(0, 50),
        shareError: undefined
      });

      this.relayClient.send(created.envelope);
      return created.transferId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send file offer through the relay.";
      this.updateState({ shareError: message });
      throw error;
    }
  }

  async acceptFileOffer(transferId: string): Promise<void> {
    const transfer = this.state.transfers.find((t) => t.transferId === transferId);
    if (!transfer) return;

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === transfer.peerDeviceId);
    if (!target) return;

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const envelope = await createFileAcceptEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId: transfer.peerDeviceId,
        transferId,
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      this.receivedChunks.set(transferId, []);

      this.updateState({
        transfers: this.state.transfers.map((t) =>
          t.transferId === transferId ? { ...t, status: "accepted" as const } : t
        )
      });

      this.relayClient.send(envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send accept envelope.";
      this.updateState({ shareError: message });
    }
  }

  async rejectFileOffer(transferId: string, reason = "Declined by recipient"): Promise<void> {
    const transfer = this.state.transfers.find((t) => t.transferId === transferId);
    if (!transfer) return;

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === transfer.peerDeviceId);
    if (!target) return;

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const envelope = await createFileRejectEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId: transfer.peerDeviceId,
        transferId,
        reason,
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      this.updateState({
        transfers: this.state.transfers.map((t) =>
          t.transferId === transferId ? { ...t, status: "rejected" as const, error: reason } : t
        )
      });

      this.relayClient.send(envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send reject envelope.";
      this.updateState({ shareError: message });
    }
  }

  async cancelFileTransfer(transferId: string, reason = "Cancelled by user"): Promise<void> {
    const transfer = this.state.transfers.find((t) => t.transferId === transferId);
    if (!transfer) return;

    this.activeFileTransfers.delete(transferId);
    this.receivedChunks.delete(transferId);

    if (isTauriRuntime()) {
      void invokeTauriCommand("close_lan_file_receiver", { transferId }).catch(() => {});
      this.lanConnectedReceivers.delete(transferId);
    }

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === transfer.peerDeviceId);
    if (target && target.online && this.state.relayConnectionState === "connected") {
      try {
        const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
        const windowsIdentity = cryptoIdentity.identity;
        const envelope = await createFileCancelEnvelope({
          fromDeviceId: windowsIdentity.deviceId,
          toDeviceId: transfer.peerDeviceId,
          transferId,
          localPrivateKey: cryptoIdentity.privateKey,
          localPublicKey: windowsIdentity.publicKey,
          peerPublicKey: target.device.publicKey
        });
        this.relayClient.send(envelope);
      } catch {
        // Suppress errors during cancel
      }
    }

    this.updateState({
      transfers: this.state.transfers.map((t) =>
        t.transferId === transferId ? { ...t, status: "cancelled" as const, error: reason } : t
      )
    });
  }

  private async startSendingFileChunks(transferId: string): Promise<void> {
    const cached = this.activeFileTransfers.get(transferId);
    if (!cached) return;

    const transfer = this.state.transfers.find((t) => t.transferId === transferId);
    if (!transfer) return;

    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === transfer.peerDeviceId);
    if (!target) return;

    try {
      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;

      // Note: Relay mode remains first-class, secure, and VPN-safe. Direct TCP is a local performance fast path.
      const useLan = target.localFastPathAvailable && isTauriRuntime();

      if (useLan) {
        // Wait up to 2 seconds for Android to connect to the receiver socket
        let waitTime = 0;
        while (!this.lanConnectedReceivers.has(transferId) && waitTime < 2000) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          waitTime += 50;
        }
      }

      let bytesTransferred = 0;
      let failedLan = false;

      for (const chunk of cached.chunks) {
        const currentTransfer = this.state.transfers.find((t) => t.transferId === transferId);
        if (!currentTransfer || currentTransfer.status !== "transferring") {
          if (useLan) {
            void invokeTauriCommand("close_lan_file_receiver", { transferId }).catch(() => {});
            this.lanConnectedReceivers.delete(transferId);
          }
          return;
        }

        const envelope = await createFileChunkEnvelope({
          fromDeviceId: windowsIdentity.deviceId,
          toDeviceId: transfer.peerDeviceId,
          payload: chunk.payload,
          localPrivateKey: cryptoIdentity.privateKey,
          localPublicKey: windowsIdentity.publicKey,
          peerPublicKey: target.device.publicKey
        });

        if (useLan && !failedLan && this.lanConnectedReceivers.has(transferId)) {
          try {
            await invokeTauriCommand("send_lan_file_chunk", {
              transferId,
              envelopeJson: JSON.stringify(envelope)
            });
          } catch (error) {
            console.warn("[CrossBridge LAN] Direct TCP chunk transfer failed, falling back to relay:", error);
            failedLan = true;
            this.relayClient.send(envelope);
          }
        } else {
          this.relayClient.send(envelope);
        }

        bytesTransferred += chunk.payload.byteLength;
        const progress = Math.min(100, Math.round((bytesTransferred / currentTransfer.fileSize) * 100));

        this.updateState({
          transfers: this.state.transfers.map((t) =>
            t.transferId === transferId
              ? {
                  ...t,
                  bytesTransferred,
                  progress
                }
              : t
          )
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const finalTransfer = this.state.transfers.find((t) => t.transferId === transferId);
      if (finalTransfer && finalTransfer.status === "transferring") {
        const completeEnvelope = await createFileCompleteEnvelope({
          fromDeviceId: windowsIdentity.deviceId,
          toDeviceId: transfer.peerDeviceId,
          transferId,
          sha256: transfer.sha256,
          localPrivateKey: cryptoIdentity.privateKey,
          localPublicKey: windowsIdentity.publicKey,
          peerPublicKey: target.device.publicKey
        });

        if (useLan && !failedLan && this.lanConnectedReceivers.has(transferId)) {
          try {
            await invokeTauriCommand("send_lan_file_chunk", {
              transferId,
              envelopeJson: JSON.stringify(completeEnvelope)
            });
          } catch (error) {
            console.warn("[CrossBridge LAN] Direct TCP complete transfer failed, falling back to relay:", error);
            this.relayClient.send(completeEnvelope);
          } finally {
            void invokeTauriCommand("close_lan_file_receiver", { transferId }).catch(() => {});
            this.lanConnectedReceivers.delete(transferId);
          }
        } else {
          this.relayClient.send(completeEnvelope);
        }

        this.updateState({
          transfers: this.state.transfers.map((t) =>
            t.transferId === transferId ? { ...t, status: "completed" as const, progress: 100 } : t
          )
        });
      }
    } catch (error) {
      if (isTauriRuntime()) {
        void invokeTauriCommand("close_lan_file_receiver", { transferId }).catch(() => {});
        this.lanConnectedReceivers.delete(transferId);
      }
      const message = error instanceof Error ? error.message : "Failed to transmit file chunks.";
      this.updateState({
        transfers: this.state.transfers.map((t) =>
          t.transferId === transferId ? { ...t, status: "failed" as const, error: message } : t
        )
      });
    } finally {
      this.activeFileTransfers.delete(transferId);
    }
  }

  private downloadFile(fileName: string, mimeType: string, bytes: Uint8Array): void {
    if (typeof window === "undefined" || !window.document) return;

    try {
      const blob = new Blob([bytes as any], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileName;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download file:", error);
    }
  }

  stop(): void {
    this.relayClient.disconnect();
  }

  private async sendLanDiscoveryProbe(toDeviceId: string): Promise<void> {
    const target = this.state.trustedDevices.find((entry) => entry.device.deviceId === toDeviceId);
    if (!target) return;

    try {
      const localIps = isTauriRuntime()
        ? await invokeTauriCommand<string[]>("get_local_ips")
        : [window.location?.hostname || "127.0.0.1"];

      const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
      const windowsIdentity = cryptoIdentity.identity;
      const envelope = await createLanDiscoveryProbeEnvelope({
        fromDeviceId: windowsIdentity.deviceId,
        toDeviceId,
        localIps,
        port: 8789,
        localPrivateKey: cryptoIdentity.privateKey,
        localPublicKey: windowsIdentity.publicKey,
        peerPublicKey: target.device.publicKey
      });

      this.relayClient.send(envelope);
    } catch (error) {
      console.error("[CrossBridge LAN Probe] Failed to send probe envelope:", error);
    }
  }


  dispose(): void {
    this.stop();
    this.unsubscribeRelayMessages();
    this.unsubscribeRelayState();
    if (typeof window !== "undefined" && this.trustedDevicesChangedHandler) {
      window.removeEventListener(TRUSTED_DEVICES_CHANGED_EVENT, this.trustedDevicesChangedHandler);
      window.removeEventListener("storage", this.trustedDevicesChangedHandler);
    }
    this.handlers.clear();
  }

  private async refreshTrustedDevices(): Promise<void> {
    try {
      const previousPeerIds = trustedPeerIdKey(this.state.trustedDevices);
      const devices = await loadTrustedDevices();
      this.updateState({
        trustedDevices: mergeTrustedDevices(this.state.trustedDevices, devices),
        error: undefined
      });
      const nextPeerIds = trustedPeerIdKey(this.state.trustedDevices);
      await this.connectIfTrusted(false, previousPeerIds !== nextPeerIds);
    } catch (error) {
      this.updateState({
        error: error instanceof Error ? error.message : "Trusted device storage failed."
      });
    }
  }

  private async connectIfTrusted(forceReconnect: boolean, announceIfConnected = false): Promise<void> {
    if (this.state.trustedDevices.length === 0) {
      this.relayClient.disconnect();
      this.updateState({ phase: "not_paired" });
      return;
    }

    if (
      !forceReconnect &&
      (this.state.relayConnectionState === "connected" ||
        this.state.relayConnectionState === "connecting" ||
        this.state.relayConnectionState === "reconnecting")
    ) {
      if (announceIfConnected) {
        this.sendTrustedDeviceHello();
      }
      return;
    }

    try {
      const windowsIdentity = await loadOrCreateWindowsIdentity();
      this.updateState({ windowsIdentity, error: undefined });
      await this.relayClient.connect(this.state.relayUrl);
    } catch (error) {
      if (this.relayClientIsRetrying()) {
        this.updateState({
          relayConnectionState: this.relayClient.getState(),
          error: undefined
        });
        return;
      }

      this.updateState({
        error: error instanceof Error ? error.message : "Could not connect to the relay."
      });
    }
  }

  private handleRelayState(relayConnectionState: RelayConnectionState): void {
    const nextTrustedDevices = relayConnectionState === "connected"
      ? this.state.trustedDevices
      : this.state.trustedDevices.map((entry) => ({
        ...entry,
        online: false,
        connectionMode: undefined
      }));

    this.updateState({
      relayConnectionState,
      trustedDevices: nextTrustedDevices,
      error: relayConnectionState === "error" ? this.state.error : undefined
    });

    if (relayConnectionState === "connected") {
      void this.sendRelayHello();
    }
  }

  private async sendRelayHello(): Promise<void> {
    try {
      const windowsIdentity = this.state.windowsIdentity ?? await loadOrCreateWindowsIdentity();
      this.updateState({ windowsIdentity, error: undefined });
      this.relayClient.send({
        type: "RELAY_HELLO",
        deviceId: windowsIdentity.deviceId,
        sessionToken: randomToken("session", 18),
        protocolVersion: 1
      });
    } catch (error) {
      if (this.relayClientIsRetrying()) {
        this.updateState({
          relayConnectionState: this.relayClient.getState(),
          error: undefined
        });
        return;
      }

      this.updateState({
        error: error instanceof Error ? error.message : "Could not announce this Windows device."
      });
    }
  }

  private sendTrustedDeviceHello(): void {
    const windowsIdentity = this.state.windowsIdentity;
    if (!windowsIdentity || this.state.relayConnectionState !== "connected") return;
    if (this.state.trustedDevices.length === 0) return;

    try {
      this.relayClient.send({
        type: MessageType.TRUSTED_DEVICE_HELLO,
        payload: {
          deviceIdentity: windowsIdentity,
          trustedPeerIds: this.state.trustedDevices.map((entry) => entry.device.deviceId)
        }
      });
    } catch (error) {
      if (this.relayClientIsRetrying()) {
        this.updateState({
          relayConnectionState: this.relayClient.getState(),
          error: undefined
        });
        return;
      }

      this.updateState({
        error: error instanceof Error ? error.message : "Could not announce trusted devices."
      });
    }
  }

  private async handleRelayMessage(message: unknown): Promise<void> {
    if (this.state.windowsIdentity && isRelayWelcome(message, this.state.windowsIdentity.deviceId)) {
      this.sendTrustedDeviceHello();
      return;
    }

    if (isRelayAck(message)) {
      const pendingDismiss = this.pendingNotificationDismissals.get(message.messageId);
      if (pendingDismiss) {
        if (!message.delivered) {
          this.pendingNotificationDismissals.delete(message.messageId);
          this.setNotificationDismissFailure(
            pendingDismiss.sourceDeviceId,
            pendingDismiss.notificationId,
            relayAckFailureMessage(message.reason).replace("device", "phone")
          );
        }
        return;
      }

      const pendingReply = this.pendingNotificationReplies.get(message.messageId);
      if (pendingReply) {
        if (!message.delivered) {
          this.pendingNotificationReplies.delete(message.messageId);
          this.setNotificationReplyFailure(
            pendingReply.sourceDeviceId,
            pendingReply.notificationId,
            relayAckFailureMessage(message.reason).replace("device", "phone")
          );
        }
        return;
      }

      if (message.delivered) {
        this.updateState({
          sentShares: markShareSent(this.state, message.messageId).sentShares,
          shareError: undefined
        });
      } else {
        const failureMessage = relayAckFailureMessage(message.reason);
        this.updateState({
          sentShares: markShareFailed(this.state, message.messageId, failureMessage).sentShares,
          shareError: failureMessage
        });
      }
      return;
    }

    if (isRelayError(message)) {
      this.updateState({ error: message.message });
      return;
    }

    const onlineMessage = TrustedDeviceOnlineMessageSchema.safeParse(message);
    if (onlineMessage.success) {
      const { deviceIdentity, timestamp } = onlineMessage.data.payload;
      if (!this.hasTrustedDevice(deviceIdentity.deviceId)) return;

      const trustedDevices = applyTrustedDeviceOnline(
        this.state.trustedDevices,
        deviceIdentity,
        timestamp
      );
      this.updateState({ trustedDevices, error: undefined });
      await this.persistLastSeen(deviceIdentity.deviceId, timestamp);
      void this.sendLanDiscoveryProbe(deviceIdentity.deviceId);
      return;
    }

    const offlineMessage = TrustedDeviceOfflineMessageSchema.safeParse(message);
    if (offlineMessage.success) {
      const { deviceId, timestamp } = offlineMessage.data.payload;
      if (!this.hasTrustedDevice(deviceId)) return;

      this.updateState({
        trustedDevices: applyTrustedDeviceOffline(this.state.trustedDevices, deviceId, timestamp),
        error: undefined
      });
      await this.persistLastSeen(deviceId, timestamp);
      return;
    }

    const statusMessage = TrustedDeviceStatusMessageSchema.safeParse(message);
    if (statusMessage.success) {
      const { deviceId, trusted, online, lastSeenAt } = statusMessage.data.payload;
      if (!trusted || !this.hasTrustedDevice(deviceId)) return;

      this.updateState({
        trustedDevices: applyTrustedDeviceStatus(
          this.state.trustedDevices,
          deviceId,
          online,
          lastSeenAt
        ),
        error: undefined
      });
      await this.persistLastSeen(deviceId, lastSeenAt);
      if (online) {
        void this.sendLanDiscoveryProbe(deviceId);
      }
      return;
    }

    // Check if it is a LAN discovery probe envelope
    const windowsIdentity = this.state.windowsIdentity;
    if (windowsIdentity) {
      const envelope = (() => {
        try {
          return typeof message === "object" && message !== null ? message as { fromDeviceId?: unknown; toDeviceId?: unknown } : undefined;
        } catch {
          return undefined;
        }
      })();
      if (envelope?.toDeviceId === windowsIdentity.deviceId && typeof envelope.fromDeviceId === "string") {
        const source = this.state.trustedDevices.find(
          (entry) => entry.device.deviceId === envelope.fromDeviceId
        );
        if (source) {
          const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
          const decodedProbe = await decodeLanDiscoveryProbeEnvelope({
            envelope: message,
            localDeviceId: windowsIdentity.deviceId,
            localPrivateKey: cryptoIdentity.privateKey,
            localPublicKey: windowsIdentity.publicKey,
            peerPublicKey: source.device.publicKey
          });

          if (decodedProbe) {
            if (decodedProbe.isReachable) {
              const trustedDevices = this.state.trustedDevices.map((entry) => {
                if (entry.device.deviceId !== decodedProbe.deviceId) return entry;
                return {
                  ...entry,
                  connectionMode: "lan" as const,
                  localFastPathAvailable: true
                };
              });
              this.updateState({ trustedDevices });
              return;
            }
          }
        }
      }
    }

    await this.handleShareEnvelope(message);
  }

  private async handleShareEnvelope(message: unknown): Promise<void> {
    const windowsIdentity = this.state.windowsIdentity;
    if (!windowsIdentity) return;
    const envelope = (() => {
      try {
        return typeof message === "object" && message !== null ? message as { fromDeviceId?: unknown; toDeviceId?: unknown } : undefined;
      } catch {
        return undefined;
      }
    })();
    if (envelope?.toDeviceId !== windowsIdentity.deviceId || typeof envelope.fromDeviceId !== "string") return;

    const source = this.state.trustedDevices.find(
      (entry) => entry.device.deviceId === envelope.fromDeviceId
    );
    if (!source) return;

    const cryptoIdentity = await loadOrCreateWindowsCryptoIdentity();
    const decoded = await decodeShareEnvelope({
      envelope: message,
      localDeviceId: windowsIdentity.deviceId,
      localPrivateKey: cryptoIdentity.privateKey,
      localPublicKey: windowsIdentity.publicKey,
      peerPublicKey: source.device.publicKey
    });

    if (decoded) {
      if (!this.replayProtector.accept(decoded.envelope)) return;

      const { controlMessage } = decoded;
      if (controlMessage.type === MessageType.TEXT_SHARE) {
        const payload = controlMessage.payload;
        if (
          payload.fromDeviceId !== decoded.envelope.fromDeviceId ||
          payload.toDeviceId !== windowsIdentity.deviceId
        ) {
          return;
        }

        const receivedAt = Date.now();
        this.updateState({
          receivedShares: addReceivedShare(this.state, {
            shareId: payload.shareId,
            messageId: decoded.envelope.messageId,
            sourceDevice: source.device,
            contentType: payload.contentType,
            text: payload.text,
            receivedAt
          }).receivedShares,
          shareError: undefined
        });

        try {
          this.relayClient.send(await createTextShareAckEnvelope({
            fromDeviceId: windowsIdentity.deviceId,
            toDeviceId: payload.fromDeviceId,
            shareId: payload.shareId,
            now: receivedAt,
            localPrivateKey: cryptoIdentity.privateKey,
            localPublicKey: windowsIdentity.publicKey,
            peerPublicKey: source.device.publicKey
          }));
        } catch {
          this.updateState({ shareError: "Received text, but the acknowledgement could not be sent." });
        }
        await this.persistLastSeen(source.device.deviceId, receivedAt);
        return;
      }

      if (controlMessage.type === MessageType.TEXT_SHARE_ACK) {
        const payload = controlMessage.payload;
        if (payload.toDeviceId !== windowsIdentity.deviceId) return;
        this.updateState({
          sentShares: markShareReceived(this.state, payload.shareId).sentShares,
          shareError: undefined
        });
        return;
      }

      if (controlMessage.type === MessageType.TEXT_SHARE_ERROR) {
        const payload = controlMessage.payload;
        if (payload.toDeviceId !== windowsIdentity.deviceId || !payload.shareId) return;
        this.updateState({
          sentShares: markShareFailed(this.state, payload.shareId, payload.message).sentShares,
          shareError: payload.message
        });
      }
      return;
    }

    const decodedNotification = await decodeNotificationEnvelope({
      envelope: message,
      localDeviceId: windowsIdentity.deviceId,
      localPrivateKey: cryptoIdentity.privateKey,
      localPublicKey: windowsIdentity.publicKey,
      peerPublicKey: source.device.publicKey
    });

    if (decodedNotification) {
      if (!this.replayProtector.accept(decodedNotification.envelope)) return;

      const { controlMessage } = decodedNotification;
      if (controlMessage.type === MessageType.NOTIFICATION_POSTED) {
        this.updateState({
          notifications: upsertMirroredNotification(this.state, {
            ...controlMessage.payload,
            sourceDevice: source.device,
            receivedAt: Date.now()
          }).notifications,
          shareError: undefined
        });
        await this.persistLastSeen(source.device.deviceId, Date.now());
        return;
      }

      if (controlMessage.type === MessageType.NOTIFICATION_REMOVED) {
        this.clearPendingNotificationDismissals(
          source.device.deviceId,
          controlMessage.payload.notificationId
        );
        this.clearPendingNotificationReplies(
          source.device.deviceId,
          controlMessage.payload.notificationId
        );
        this.updateState({
          notifications: removeMirroredNotification(
            this.state,
            source.device.deviceId,
            controlMessage.payload.notificationId
          ).notifications,
          shareError: undefined
        });
        await this.persistLastSeen(source.device.deviceId, Date.now());
        return;
      }

      if (controlMessage.type === MessageType.NOTIFICATION_DISMISS_RESULT) {
        this.clearPendingNotificationDismissals(
          source.device.deviceId,
          controlMessage.payload.notificationId
        );

        if (controlMessage.payload.dismissed) {
          this.updateState({
            notifications: removeMirroredNotification(
              this.state,
              source.device.deviceId,
              controlMessage.payload.notificationId
            ).notifications
          });
        } else {
          this.setNotificationDismissFailure(
            source.device.deviceId,
            controlMessage.payload.notificationId,
            controlMessage.payload.message ?? "Android could not dismiss that notification."
          );
        }

        await this.persistLastSeen(source.device.deviceId, Date.now());
        return;
      }

      if (controlMessage.type === MessageType.NOTIFICATION_REPLY_RESULT) {
        this.clearPendingNotificationReplies(
          source.device.deviceId,
          controlMessage.payload.notificationId,
          controlMessage.payload.actionId
        );

        if (controlMessage.payload.replied) {
          this.updateState({
            notifications: markMirroredNotificationReplySent(
              this.state,
              source.device.deviceId,
              controlMessage.payload.notificationId,
              controlMessage.payload.message ?? "Reply sent to Android."
            ).notifications
          });
        } else {
          this.setNotificationReplyFailure(
            source.device.deviceId,
            controlMessage.payload.notificationId,
            controlMessage.payload.message ?? "Android could not send that reply."
          );
        }

        await this.persistLastSeen(source.device.deviceId, Date.now());
        return;
      }
    }

    // Try decoding file transfer envelopes
    const decodedFile = await decodeFileTransferEnvelope({
      envelope: message,
      localDeviceId: windowsIdentity.deviceId,
      localPrivateKey: cryptoIdentity.privateKey,
      localPublicKey: windowsIdentity.publicKey,
      peerPublicKey: source.device.publicKey
    });

    if (decodedFile) {
      if (!this.replayProtector.accept(decodedFile.envelope)) return;

      const { controlMessage } = decodedFile;
      const { type, payload } = controlMessage;

      switch (type) {
        case MessageType.FILE_OFFER: {
          const offer = payload as FileOfferPayload;
          const transferState: FileTransferState = {
            transferId: offer.transferId,
            peerDeviceId: offer.fromDeviceId,
            fileName: offer.fileName,
            fileSize: offer.fileSize,
            direction: offer.direction,
            bytesTransferred: 0,
            status: "offered" as const,
            progress: 0,
            riskyWarning: inferRiskyFileWarning(offer.fileName),
            sha256: offer.sha256,
            mimeType: offer.mimeType
          };

          this.updateState({
            transfers: [transferState, ...this.state.transfers.filter((t) => t.transferId !== offer.transferId)].slice(0, 50),
            shareError: undefined
          });
          await this.persistLastSeen(source.device.deviceId, Date.now());
          break;
        }

        case MessageType.FILE_ACCEPT: {
          const accept = payload as FileAcceptPayload;
          const transfer = this.state.transfers.find((t) => t.transferId === accept.transferId);
          if (!transfer || transfer.status !== "offered") return;

          this.updateState({
            transfers: this.state.transfers.map((t) =>
              t.transferId === accept.transferId ? { ...t, status: "transferring" as const } : t
            )
          });

          void this.startSendingFileChunks(accept.transferId);
          break;
        }

        case MessageType.FILE_REJECT: {
          const reject = payload as FileRejectPayload;
          this.updateState({
            transfers: this.state.transfers.map((t) =>
              t.transferId === reject.transferId ? { ...t, status: "rejected" as const, error: reject.reason } : t
            )
          });
          this.activeFileTransfers.delete(reject.transferId);
          break;
        }

        case MessageType.FILE_CHUNK: {
          const chunk = payload as FileChunkPayload;
          const transfer = this.state.transfers.find((t) => t.transferId === chunk.transferId);
          if (!transfer || (transfer.status !== "accepted" && transfer.status !== "transferring")) return;

          let chunks = this.receivedChunks.get(chunk.transferId);
          if (!chunks) {
            chunks = [];
            this.receivedChunks.set(chunk.transferId, chunks);
          }
          chunks.push(chunk);

          const bytesTransferred = chunks.reduce((sum, c) => sum + c.byteLength, 0);
          const progress = Math.min(100, Math.round((bytesTransferred / transfer.fileSize) * 100));

          this.updateState({
            transfers: this.state.transfers.map((t) =>
              t.transferId === chunk.transferId
                ? {
                    ...t,
                    status: "transferring" as const,
                    bytesTransferred,
                    progress
                  }
                : t
            )
          });
          break;
        }

        case MessageType.FILE_COMPLETE: {
          const complete = payload as FileCompletePayload;
          const transfer = this.state.transfers.find((t) => t.transferId === complete.transferId);
          if (!transfer || transfer.status !== "transferring") return;

          try {
            const chunks = this.receivedChunks.get(complete.transferId) ?? [];
            const fileBytes = reassembleTransferredFile(chunks, complete.sha256);

            this.downloadFile(transfer.fileName, transfer.mimeType ?? "application/octet-stream", fileBytes);

            this.updateState({
              transfers: this.state.transfers.map((t) =>
                t.transferId === complete.transferId ? { ...t, status: "completed" as const, progress: 100 } : t
              )
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "SHA-256 verification failed.";
            this.updateState({
              transfers: this.state.transfers.map((t) =>
                t.transferId === complete.transferId ? { ...t, status: "failed" as const, error: errorMsg } : t
              )
            });
          } finally {
            this.receivedChunks.delete(complete.transferId);
          }
          break;
        }

        case MessageType.FILE_CANCEL: {
          const cancel = payload as FileCancelPayload;
          this.updateState({
            transfers: this.state.transfers.map((t) =>
              t.transferId === cancel.transferId ? { ...t, status: "cancelled" as const, error: "Cancelled by peer." } : t
            )
          });
          this.activeFileTransfers.delete(cancel.transferId);
          this.receivedChunks.delete(cancel.transferId);
          break;
        }
      }
      return;
    }

    this.updateState({ shareError: "Received an encrypted message that could not be decrypted." });
  }

  private hasTrustedDevice(deviceId: string): boolean {
    return this.state.trustedDevices.some((entry) => entry.device.deviceId === deviceId);
  }

  private clearPendingNotificationDismissals(sourceDeviceId: string, notificationId: string): void {
    for (const [messageId, pending] of this.pendingNotificationDismissals.entries()) {
      if (
        pending.sourceDeviceId === sourceDeviceId &&
        pending.notificationId === notificationId
      ) {
        this.pendingNotificationDismissals.delete(messageId);
      }
    }
  }

  private clearPendingNotificationReplies(
    sourceDeviceId: string,
    notificationId: string,
    actionId?: string
  ): void {
    for (const [messageId, pending] of this.pendingNotificationReplies.entries()) {
      if (
        pending.sourceDeviceId === sourceDeviceId &&
        pending.notificationId === notificationId &&
        (actionId === undefined || pending.actionId === actionId)
      ) {
        this.pendingNotificationReplies.delete(messageId);
      }
    }
  }

  private setNotificationDismissFailure(
    sourceDeviceId: string,
    notificationId: string,
    message: string
  ): void {
    this.clearPendingNotificationDismissals(sourceDeviceId, notificationId);
    this.updateState({
      notifications: markMirroredNotificationDismissFailed(
        this.state,
        sourceDeviceId,
        notificationId,
        message
      ).notifications
    });
  }

  private setNotificationReplyFailure(
    sourceDeviceId: string,
    notificationId: string,
    message: string
  ): void {
    this.clearPendingNotificationReplies(sourceDeviceId, notificationId);
    this.updateState({
      notifications: markMirroredNotificationReplyFailed(
        this.state,
        sourceDeviceId,
        notificationId,
        message
      ).notifications
    });
  }

  private async persistLastSeen(deviceId: string, lastSeenAt: number): Promise<void> {
    const device = this.state.trustedDevices.find((entry) => entry.device.deviceId === deviceId)?.device;
    if (!device) return;
    await saveTrustedDevice({
      ...device,
      lastSeenAt
    });
  }

  private updateState(nextState: Partial<ConnectionViewState>): void {
    const nextRelayState = nextState.relayConnectionState ?? this.state.relayConnectionState;
    const nextTrustedDevices = nextState.trustedDevices ?? this.state.trustedDevices;
    const nextError = Object.hasOwn(nextState, "error") ? nextState.error : this.state.error;
    this.state = {
      ...this.state,
      ...nextState,
      phase: nextState.phase ?? phaseFor(nextRelayState, nextTrustedDevices, nextError)
    };
    for (const handler of this.handlers) {
      handler(this.state);
    }
  }

  private relayClientIsRetrying(): boolean {
    const relayState = this.relayClient.getState();
    return relayState === "connecting" || relayState === "reconnecting";
  }
}

function trustedPeerIdKey(devices: TrustedDeviceConnection[]): string {
  return devices
    .map((entry) => entry.device.deviceId)
    .sort()
    .join("|");
}

function mergeTrustedDevices(
  current: TrustedDeviceConnection[],
  devices: TrustedDevice[]
): TrustedDeviceConnection[] {
  const currentById = new Map(current.map((entry) => [entry.device.deviceId, entry]));
  return devices.map((device) => {
    const existing = currentById.get(device.deviceId);
    return {
      device: {
        ...device,
        lastSeenAt: existing?.lastSeenAt ?? device.lastSeenAt
      },
      online: existing?.online ?? false,
      connectionMode: existing?.online ? existing.connectionMode : undefined,
      lastSeenAt: existing?.lastSeenAt ?? device.lastSeenAt
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function markMostRecentSendingShareFailed(
  sentShares: SentShare[],
  statusMessage: string
): SentShare[] {
  let updated = false;
  return sentShares.map((share) => {
    if (updated || share.status !== "sending") return share;
    updated = true;
    return {
      ...share,
      status: "failed",
      statusMessage
    };
  });
}
