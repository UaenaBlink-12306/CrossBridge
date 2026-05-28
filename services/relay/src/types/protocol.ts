import { DeviceIdSchema, EncryptedEnvelopeSchema } from "@crossbridge/protocol";
import { z } from "zod";

export const RelayHelloSchema = z.object({
  type: z.literal("RELAY_HELLO"),
  deviceId: DeviceIdSchema,
  sessionToken: z.string().trim().min(8).max(512),
  protocolVersion: z.literal(1)
}).strict();

export const RelayAckSchema = z.object({
  type: z.literal("RELAY_ACK"),
  messageId: z.string().trim().min(3).max(128),
  delivered: z.boolean(),
  reason: z.string().trim().min(1).max(128).optional()
}).strict();

export const RelayWelcomeSchema = z.object({
  type: z.literal("RELAY_WELCOME"),
  deviceId: DeviceIdSchema,
  protocolVersion: z.literal(1)
}).strict();

export { EncryptedEnvelopeSchema };

export type RelayHello = z.infer<typeof RelayHelloSchema>;
export type RelayAck = z.infer<typeof RelayAckSchema>;
export type RelayWelcome = z.infer<typeof RelayWelcomeSchema>;
