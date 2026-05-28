import { randomBytes, randomUUID } from "node:crypto";
import {
  derivePairingCode,
  type DeviceIdentity,
  type PairingCompletePayload,
  type PairingQrPayload,
  type TrustedDevice
} from "@crossbridge/protocol";

export type PairingSessionStatus =
  | "WAITING_FOR_ANDROID"
  | "ANDROID_JOINED"
  | "CONFIRMED"
  | "EXPIRED";

export type PairingSessionErrorCode =
  | "PAIRING_SESSION_NOT_FOUND"
  | "PAIRING_SESSION_EXPIRED"
  | "PAIRING_TOKEN_INVALID"
  | "PAIRING_ALREADY_JOINED"
  | "PAIRING_ALREADY_COMPLETED"
  | "PAIRING_NOT_READY"
  | "PAIRING_UNKNOWN_DEVICE"
  | "PAIRING_INVALID_PLATFORM";

export class PairingSessionError extends Error {
  constructor(readonly code: PairingSessionErrorCode, message: string) {
    super(message);
    this.name = "PairingSessionError";
  }
}

export interface PairingSession {
  pairingSessionId: string;
  pairingToken: string;
  pcIdentity: DeviceIdentity;
  androidIdentity?: DeviceIdentity;
  expiresAt: number;
  status: PairingSessionStatus;
  verificationCode?: string;
  confirmedDeviceIds: Set<string>;
  pairedAt?: number;
}

export interface PairingSessionManagerOptions {
  ttlMs?: number;
  createSessionId?: () => string;
  createPairingToken?: () => string;
}

export interface PairingJoinResult {
  session: PairingSession;
  verificationCode: string;
}

export type PairingConfirmResult =
  | { complete: false; session: PairingSession }
  | { complete: true; session: PairingSession; payload: PairingCompletePayload };

const DEFAULT_TTL_MS = 2 * 60 * 1000;

function defaultSessionId(): string {
  return `pair_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function defaultPairingToken(): string {
  return randomBytes(18).toString("base64url");
}

function toTrustedDevice(identity: DeviceIdentity, pairedAt: number): TrustedDevice {
  return {
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    platform: identity.platform,
    publicKey: identity.publicKey,
    pairedAt
  };
}

export class PairingSessionManager {
  private readonly sessions = new Map<string, PairingSession>();
  private readonly ttlMs: number;
  private readonly createSessionId: () => string;
  private readonly createPairingToken: () => string;

  constructor(options: PairingSessionManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.createPairingToken = options.createPairingToken ?? defaultPairingToken;
  }

  createSession(
    pcIdentity: DeviceIdentity,
    relayUrl: string,
    now = Date.now()
  ): { session: PairingSession; qrPayload: PairingQrPayload } {
    if (pcIdentity.platform !== "windows") {
      throw new PairingSessionError(
        "PAIRING_INVALID_PLATFORM",
        "Only Windows identities can create pairing sessions."
      );
    }

    const pairingSessionId = this.createSessionId();
    const pairingToken = this.createPairingToken();
    const expiresAt = now + this.ttlMs;
    const session: PairingSession = {
      pairingSessionId,
      pairingToken,
      pcIdentity,
      expiresAt,
      status: "WAITING_FOR_ANDROID",
      confirmedDeviceIds: new Set<string>()
    };

    this.sessions.set(pairingSessionId, session);

    return {
      session,
      qrPayload: {
        protocol: "crossbridge-v1",
        pairingSessionId,
        relayUrl,
        pcDeviceId: pcIdentity.deviceId,
        pcDeviceName: pcIdentity.deviceName,
        pcPublicKey: pcIdentity.publicKey,
        pairingToken,
        expiresAt
      }
    };
  }

  joinSession(
    pairingSessionId: string,
    pairingToken: string,
    androidIdentity: DeviceIdentity,
    now = Date.now()
  ): PairingJoinResult {
    if (androidIdentity.platform !== "android") {
      throw new PairingSessionError(
        "PAIRING_INVALID_PLATFORM",
        "Only Android identities can join pairing sessions."
      );
    }

    const session = this.getSessionOrThrow(pairingSessionId, now);
    if (session.status === "CONFIRMED") {
      throw new PairingSessionError(
        "PAIRING_ALREADY_COMPLETED",
        "Pairing session has already completed."
      );
    }
    if (session.pairingToken !== pairingToken) {
      throw new PairingSessionError(
        "PAIRING_TOKEN_INVALID",
        "Pairing token is invalid."
      );
    }
    if (session.status === "ANDROID_JOINED") {
      throw new PairingSessionError(
        "PAIRING_ALREADY_JOINED",
        "An Android device has already joined this pairing session."
      );
    }

    const verificationCode = derivePairingCode(
      session.pcIdentity.publicKey,
      androidIdentity.publicKey,
      session.pairingSessionId
    );
    session.androidIdentity = androidIdentity;
    session.verificationCode = verificationCode;
    session.status = "ANDROID_JOINED";

    return { session, verificationCode };
  }

  confirmPairing(
    pairingSessionId: string,
    deviceId: string,
    now = Date.now()
  ): PairingConfirmResult {
    const session = this.getSessionOrThrow(pairingSessionId, now);
    if (session.status === "CONFIRMED") {
      throw new PairingSessionError(
        "PAIRING_ALREADY_COMPLETED",
        "Pairing session has already completed."
      );
    }
    if (session.status !== "ANDROID_JOINED" || !session.androidIdentity) {
      throw new PairingSessionError(
        "PAIRING_NOT_READY",
        "Pairing session is not ready for confirmation."
      );
    }

    const participantIds = new Set([
      session.pcIdentity.deviceId,
      session.androidIdentity.deviceId
    ]);
    if (!participantIds.has(deviceId)) {
      throw new PairingSessionError(
        "PAIRING_UNKNOWN_DEVICE",
        "Only the paired Windows PC or Android phone can confirm this session."
      );
    }

    session.confirmedDeviceIds.add(deviceId);
    if (session.confirmedDeviceIds.size < 2) {
      return { complete: false, session };
    }

    const pairedAt = now;
    session.pairedAt = pairedAt;
    session.status = "CONFIRMED";

    return {
      complete: true,
      session,
      payload: {
        pairingSessionId: session.pairingSessionId,
        trustedDevices: [
          toTrustedDevice(session.pcIdentity, pairedAt),
          toTrustedDevice(session.androidIdentity, pairedAt)
        ]
      }
    };
  }

  get(pairingSessionId: string): PairingSession | undefined {
    return this.sessions.get(pairingSessionId);
  }

  cleanup(now = Date.now()): void {
    for (const [pairingSessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        session.status = "EXPIRED";
        this.sessions.delete(pairingSessionId);
      }
    }
  }

  size(): number {
    return this.sessions.size;
  }

  private getSessionOrThrow(pairingSessionId: string, now: number): PairingSession {
    const session = this.sessions.get(pairingSessionId);
    if (!session) {
      throw new PairingSessionError(
        "PAIRING_SESSION_NOT_FOUND",
        "Pairing session was not found."
      );
    }

    if (session.status !== "CONFIRMED" && session.expiresAt <= now) {
      session.status = "EXPIRED";
      throw new PairingSessionError(
        "PAIRING_SESSION_EXPIRED",
        "Pairing session has expired."
      );
    }

    return session;
  }
}
