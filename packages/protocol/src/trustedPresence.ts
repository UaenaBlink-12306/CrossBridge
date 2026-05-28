import { z } from "zod";
import { MessageType } from "./messageTypes.js";
import { DeviceIdentitySchema } from "./pairing.js";
import { DeviceIdSchema, TimestampSchema } from "./validators.js";

export const TrustedDeviceHelloPayloadSchema = z.object({
  deviceIdentity: DeviceIdentitySchema,
  trustedPeerIds: z.array(DeviceIdSchema).max(256)
}).strict();

export const TrustedDeviceOnlinePayloadSchema = z.object({
  deviceIdentity: DeviceIdentitySchema,
  connectionMode: z.literal("relay"),
  timestamp: TimestampSchema
}).strict();

export const TrustedDeviceOfflinePayloadSchema = z.object({
  deviceId: DeviceIdSchema,
  timestamp: TimestampSchema
}).strict();

export const TrustedDeviceStatusPayloadSchema = z.object({
  deviceId: DeviceIdSchema,
  trusted: z.boolean(),
  online: z.boolean(),
  lastSeenAt: TimestampSchema
}).strict();

const trustedDeviceControlMessage = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  type: z.literal(type),
  payload
}).strict();

export const TrustedDeviceHelloMessageSchema = trustedDeviceControlMessage(
  MessageType.TRUSTED_DEVICE_HELLO,
  TrustedDeviceHelloPayloadSchema
);

export const TrustedDeviceOnlineMessageSchema = trustedDeviceControlMessage(
  MessageType.TRUSTED_DEVICE_ONLINE,
  TrustedDeviceOnlinePayloadSchema
);

export const TrustedDeviceOfflineMessageSchema = trustedDeviceControlMessage(
  MessageType.TRUSTED_DEVICE_OFFLINE,
  TrustedDeviceOfflinePayloadSchema
);

export const TrustedDeviceStatusMessageSchema = trustedDeviceControlMessage(
  MessageType.TRUSTED_DEVICE_STATUS,
  TrustedDeviceStatusPayloadSchema
);

export const TrustedDeviceControlMessageSchema = z.discriminatedUnion("type", [
  TrustedDeviceHelloMessageSchema,
  TrustedDeviceOnlineMessageSchema,
  TrustedDeviceOfflineMessageSchema,
  TrustedDeviceStatusMessageSchema
]);

export type TrustedDeviceHelloPayload = z.infer<typeof TrustedDeviceHelloPayloadSchema>;
export type TrustedDeviceOnlinePayload = z.infer<typeof TrustedDeviceOnlinePayloadSchema>;
export type TrustedDeviceOfflinePayload = z.infer<typeof TrustedDeviceOfflinePayloadSchema>;
export type TrustedDeviceStatusPayload = z.infer<typeof TrustedDeviceStatusPayloadSchema>;
export type TrustedDeviceControlMessage = z.infer<typeof TrustedDeviceControlMessageSchema>;
