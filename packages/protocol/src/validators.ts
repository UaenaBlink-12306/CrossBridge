import { z } from "zod";
import { ErrorCodeSchema } from "./errors.js";
import { MessageType } from "./messageTypes.js";

const emptyPayloadSchema = z.object({}).strict();
const TEXT_SHARE_MAX_LENGTH = 20_000;

export const DeviceIdSchema = z.string().trim().min(3).max(128);
export const MessageIdSchema = z.string().trim().min(3).max(128);
export const TimestampSchema = z.number().int().nonnegative();
export const Base64Schema = z.string().trim().min(1);
export const HexSha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const EncryptedEnvelopeSchema = z.object({
  version: z.literal(1),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  messageId: MessageIdSchema,
  timestamp: TimestampSchema,
  nonce: Base64Schema,
  ciphertext: Base64Schema,
  algorithm: z.string().trim().min(1).max(128).optional(),
  keyId: z.string().trim().min(1).max(128).optional()
}).strict();

const baseMessageShape = {
  version: z.literal(1),
  id: MessageIdSchema,
  timestamp: TimestampSchema
};

export const SecureAppMessageSchema = z.object({
  ...baseMessageShape,
  type: z.nativeEnum(MessageType),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  payload: z.unknown()
}).strict();

const messageSchema = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  ...baseMessageShape,
  type: z.literal(type),
  payload
}).strict();

function isValidHttpUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !/\s/.test(trimmed);
  } catch {
    return false;
  }
}

export const PingMessageSchema = messageSchema(MessageType.PING, emptyPayloadSchema);

export const PongMessageSchema = messageSchema(MessageType.PONG, z.object({
  deviceId: DeviceIdSchema,
  batteryPercent: z.number().int().min(0).max(100).optional(),
  charging: z.boolean().optional()
}).strict());

export const PairingHelloMessageSchema = messageSchema(MessageType.PAIRING_HELLO, z.object({
  deviceId: DeviceIdSchema,
  deviceName: z.string().trim().min(1).max(128),
  publicKey: Base64Schema,
  pairingToken: z.string().trim().min(8).max(512).optional()
}).strict());

export const PairingConfirmMessageSchema = messageSchema(MessageType.PAIRING_CONFIRM, z.object({
  verificationCode: z.string().regex(/^[0-9]{6}$/),
  accepted: z.boolean()
}).strict());

export const PairingCompleteMessageSchema = messageSchema(MessageType.PAIRING_COMPLETE, z.object({
  trustedDeviceId: DeviceIdSchema
}).strict());

export const DeviceStatusMessageSchema = messageSchema(MessageType.DEVICE_STATUS, z.object({
  batteryPercent: z.number().int().min(0).max(100),
  charging: z.boolean(),
  deviceName: z.string().trim().min(1).max(128),
  androidVersion: z.string().trim().min(1).max(32).optional(),
  connectionMode: z.enum(["DIRECT_LAN", "RELAY", "DISCONNECTED", "RECONNECTING"])
}).strict());

export const TextShareMessageSchema = messageSchema(MessageType.TEXT_SHARE, z.object({
  shareId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  contentType: z.enum(["text", "url"]),
  text: z.string()
    .max(TEXT_SHARE_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, "text must not be blank"),
  createdAt: TimestampSchema
}).strict().refine(
  (payload) => payload.contentType !== "url" || isValidHttpUrl(payload.text),
  {
    path: ["text"],
    message: "url shares must contain a valid http:// or https:// URL"
  }
));

export const TextShareAckMessageSchema = messageSchema(MessageType.TEXT_SHARE_ACK, z.object({
  shareId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  receivedAt: TimestampSchema
}).strict());

export const TextShareErrorMessageSchema = messageSchema(MessageType.TEXT_SHARE_ERROR, z.object({
  shareId: z.string().trim().min(3).max(128).optional(),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema.optional(),
  errorCode: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(512)
}).strict());

export const FileOfferMessageSchema = messageSchema(MessageType.FILE_OFFER, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().trim().min(1).max(255),
  sha256: HexSha256Schema,
  direction: z.enum(["ANDROID_TO_WINDOWS", "WINDOWS_TO_ANDROID"]),
  createdAt: TimestampSchema
}).strict());

export const FileAcceptMessageSchema = messageSchema(MessageType.FILE_ACCEPT, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  accepted: z.boolean(),
  acceptedAt: TimestampSchema
}).strict());

export const FileRejectMessageSchema = messageSchema(MessageType.FILE_REJECT, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  reason: z.string().trim().min(1).max(512)
}).strict());

export const FileChunkMessageSchema = messageSchema(MessageType.FILE_CHUNK, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
  byteLength: z.number().int().nonnegative(),
  chunkHash: HexSha256Schema,
  data: Base64Schema
}).strict());

export const FileProgressMessageSchema = messageSchema(MessageType.FILE_PROGRESS, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  bytesTransferred: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative()
}).strict());

export const FileCompleteMessageSchema = messageSchema(MessageType.FILE_COMPLETE, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  sha256: HexSha256Schema,
  completedAt: TimestampSchema
}).strict());

export const FileCancelMessageSchema = messageSchema(MessageType.FILE_CANCEL, z.object({
  transferId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  reason: z.string().trim().min(1).max(512).optional()
}).strict());

const notificationActionSchema = z.object({
  actionId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(128),
  supportsRemoteInput: z.boolean()
}).strict();

export const NotificationPostedMessageSchema = messageSchema(MessageType.NOTIFICATION_POSTED, z.object({
  notificationId: z.string().trim().min(1).max(256),
  packageName: z.string().trim().min(1).max(256),
  appName: z.string().trim().min(1).max(128),
  title: z.string().max(512).nullable(),
  text: z.string().max(4096).nullable(),
  subText: z.string().max(512).nullable(),
  postTime: TimestampSchema,
  canDismiss: z.boolean(),
  actions: z.array(notificationActionSchema).max(16)
}).strict());

export const NotificationRemovedMessageSchema = messageSchema(MessageType.NOTIFICATION_REMOVED, z.object({
  notificationId: z.string().trim().min(1).max(256)
}).strict());

export const NotificationDismissMessageSchema = messageSchema(MessageType.NOTIFICATION_DISMISS, z.object({
  notificationId: z.string().trim().min(1).max(256)
}).strict());

export const NotificationReplyMessageSchema = messageSchema(MessageType.NOTIFICATION_REPLY, z.object({
  notificationId: z.string().trim().min(1).max(256),
  actionId: z.string().trim().min(1).max(128),
  replyText: z.string()
    .max(4096)
    .refine((value) => value.trim().length > 0, "replyText must not be blank")
}).strict());

export const NotificationReplyResultMessageSchema = messageSchema(MessageType.NOTIFICATION_REPLY_RESULT, z.object({
  notificationId: z.string().trim().min(1).max(256),
  actionId: z.string().trim().min(1).max(128),
  replied: z.boolean(),
  errorCode: ErrorCodeSchema.nullable().optional(),
  message: z.string().trim().min(1).max(512).nullable().optional()
}).strict());

export const ErrorMessageSchema = messageSchema(MessageType.ERROR, z.object({
  code: ErrorCodeSchema,
  message: z.string().trim().min(1).max(512),
  details: z.record(z.string(), z.unknown()).optional()
}).strict());

export const CrossBridgeMessageSchema = z.discriminatedUnion("type", [
  PingMessageSchema,
  PongMessageSchema,
  PairingHelloMessageSchema,
  PairingConfirmMessageSchema,
  PairingCompleteMessageSchema,
  DeviceStatusMessageSchema,
  TextShareMessageSchema,
  TextShareAckMessageSchema,
  TextShareErrorMessageSchema,
  FileOfferMessageSchema,
  FileAcceptMessageSchema,
  FileRejectMessageSchema,
  FileChunkMessageSchema,
  FileProgressMessageSchema,
  FileCompleteMessageSchema,
  FileCancelMessageSchema,
  NotificationPostedMessageSchema,
  NotificationRemovedMessageSchema,
  NotificationDismissMessageSchema,
  NotificationReplyMessageSchema,
  NotificationReplyResultMessageSchema,
  ErrorMessageSchema
]);

export type CrossBridgeMessage = z.infer<typeof CrossBridgeMessageSchema>;
export type EncryptedEnvelopeInput = z.infer<typeof EncryptedEnvelopeSchema>;
export type SecureAppMessageInput = z.infer<typeof SecureAppMessageSchema>;

export const RISKY_FILE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".scr",
  ".js",
  ".jar"
]);

export function parseMessage(input: unknown): CrossBridgeMessage {
  return CrossBridgeMessageSchema.parse(input);
}

export function parseEncryptedEnvelope(input: unknown): EncryptedEnvelopeInput {
  return EncryptedEnvelopeSchema.parse(input);
}

export function parseSecureAppMessage(input: unknown): SecureAppMessageInput {
  return SecureAppMessageSchema.parse(input);
}

export function isRiskyFileName(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot < 0) return false;
  return RISKY_FILE_EXTENSIONS.has(normalized.slice(lastDot));
}
