import type {
  DeviceIdentity,
  PairingQrPayload,
  TrustedDevice
} from "@crossbridge/protocol";

export type { DeviceIdentity, PairingQrPayload, TrustedDevice };

export type RelayConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type PairingState =
  | "idle"
  | "connecting"
  | "session_created"
  | "waiting_for_android"
  | "android_joined"
  | "waiting_for_confirmation"
  | "confirmed"
  | "complete"
  | "expired"
  | "error";

export interface PairingViewState {
  state: PairingState;
  relayConnected: boolean;
  relayConnectionState: RelayConnectionState;
  qrPayload?: PairingQrPayload;
  verificationCode?: string;
  pcIdentity?: DeviceIdentity;
  androidIdentity?: DeviceIdentity;
  trustedAndroidDevice?: TrustedDevice;
  error?: string;
  expiresAt?: number;
}

export interface PairingSessionCreatedMessage {
  type: "PAIRING_SESSION_CREATED";
  payload: {
    qrPayload: PairingQrPayload;
  };
}

export interface PairingJoinedMessage {
  type: "PAIRING_JOINED";
  payload: {
    pairingSessionId: string;
    pcIdentity: DeviceIdentity;
    androidIdentity: DeviceIdentity;
    verificationCode: string;
  };
}

export interface PairingCompleteMessage {
  type: "PAIRING_COMPLETE";
  payload: {
    pairingSessionId: string;
    trustedDevices: TrustedDevice[];
  };
}

export interface PairingExpiredMessage {
  type: "PAIRING_EXPIRED";
  payload: {
    pairingSessionId: string;
    expiresAt: number;
  };
}
