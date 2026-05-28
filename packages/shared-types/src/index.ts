export type ConnectionMode = "DIRECT_LAN" | "RELAY" | "DISCONNECTED" | "RECONNECTING";

export interface DeviceSummary {
  deviceId: string;
  deviceName: string;
  connectionMode: ConnectionMode;
  batteryPercent?: number;
  charging?: boolean;
  lastSeenAt: number;
}

export interface TransferSummary {
  transferId: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  direction: "ANDROID_TO_WINDOWS" | "WINDOWS_TO_ANDROID";
  status: "offered" | "active" | "complete" | "cancelled" | "failed";
}
