import { z } from "zod";

export enum ErrorCode {
  VERSION_UNSUPPORTED = "VERSION_UNSUPPORTED",
  UNTRUSTED_DEVICE = "UNTRUSTED_DEVICE",
  PAIRING_EXPIRED = "PAIRING_EXPIRED",
  PERMISSION_MISSING = "PERMISSION_MISSING",
  NOTIFICATION_REPLY_UNSUPPORTED = "NOTIFICATION_REPLY_UNSUPPORTED",
  FILE_HASH_MISMATCH = "FILE_HASH_MISMATCH",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  RELAY_UNAVAILABLE = "RELAY_UNAVAILABLE",
  LOCAL_NETWORK_BLOCKED = "LOCAL_NETWORK_BLOCKED",
  NETWORK_BLOCKED = "NETWORK_BLOCKED",
  UNKNOWN = "UNKNOWN"
}

export const ErrorCodeSchema = z.nativeEnum(ErrorCode);

export const USER_SAFE_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.VERSION_UNSUPPORTED]: "This device is using an unsupported CrossBridge version.",
  [ErrorCode.UNTRUSTED_DEVICE]: "This device is not trusted yet. Pair it again to continue.",
  [ErrorCode.PAIRING_EXPIRED]: "This pairing code expired. Start pairing again.",
  [ErrorCode.PERMISSION_MISSING]: "A required permission is not enabled.",
  [ErrorCode.NOTIFICATION_REPLY_UNSUPPORTED]: "This notification does not support replies.",
  [ErrorCode.FILE_HASH_MISMATCH]: "The file was received but failed verification, so it was deleted.",
  [ErrorCode.FILE_TOO_LARGE]: "This file is larger than the current transfer limit.",
  [ErrorCode.RELAY_UNAVAILABLE]: "Encrypted relay is unavailable right now.",
  [ErrorCode.LOCAL_NETWORK_BLOCKED]: "Local connection is blocked. Relay mode is still active.",
  [ErrorCode.NETWORK_BLOCKED]: "Both local and relay connections are blocked by this network.",
  [ErrorCode.UNKNOWN]: "CrossBridge could not complete that action."
};

export function userMessageForError(code: ErrorCode): string {
  return USER_SAFE_ERROR_MESSAGES[code] ?? USER_SAFE_ERROR_MESSAGES[ErrorCode.UNKNOWN];
}
