import { z } from "zod";
import { MessageType } from "./messageTypes.js";
import { DeviceIdSchema, TimestampSchema } from "./validators.js";

export const LanDiscoveryProbePayloadSchema = z.object({
  deviceId: DeviceIdSchema,
  localIps: z.array(z.string()).max(32),
  port: z.number().int().min(1024).max(65535),
  timestamp: TimestampSchema,
  isReachable: z.boolean().optional()
}).strict();

export const LanDiscoveryProbeMessageSchema = z.object({
  type: z.literal(MessageType.LAN_DISCOVERY_PROBE),
  payload: LanDiscoveryProbePayloadSchema
}).strict();

export type LanDiscoveryProbePayload = z.infer<typeof LanDiscoveryProbePayloadSchema>;
export type LanDiscoveryProbeMessage = z.infer<typeof LanDiscoveryProbeMessageSchema>;
