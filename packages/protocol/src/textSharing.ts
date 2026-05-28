import { z } from "zod";
import { MessageType } from "./messageTypes.js";
import { DeviceIdSchema, TimestampSchema } from "./validators.js";

export const TEXT_SHARE_MAX_LENGTH = 20_000;

const nonBlankShareText = z.string()
  .max(TEXT_SHARE_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, "text must not be blank");

export const TextSharePayloadSchema = z.object({
  shareId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  contentType: z.enum(["text", "url"]),
  text: nonBlankShareText,
  createdAt: TimestampSchema
}).strict().refine(
  (payload) => payload.contentType !== "url" || isValidHttpUrl(payload.text),
  {
    path: ["text"],
    message: "url shares must contain a valid http:// or https:// URL"
  }
);

export const TextShareAckPayloadSchema = z.object({
  shareId: z.string().trim().min(3).max(128),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema,
  receivedAt: TimestampSchema
}).strict();

export const TextShareErrorPayloadSchema = z.object({
  shareId: z.string().trim().min(3).max(128).optional(),
  fromDeviceId: DeviceIdSchema,
  toDeviceId: DeviceIdSchema.optional(),
  errorCode: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(512)
}).strict();

const textShareControlMessage = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  type: z.literal(type),
  payload
}).strict();

export const TextShareControlMessageSchema = textShareControlMessage(
  MessageType.TEXT_SHARE,
  TextSharePayloadSchema
);

export const TextShareAckControlMessageSchema = textShareControlMessage(
  MessageType.TEXT_SHARE_ACK,
  TextShareAckPayloadSchema
);

export const TextShareErrorControlMessageSchema = textShareControlMessage(
  MessageType.TEXT_SHARE_ERROR,
  TextShareErrorPayloadSchema
);

export const TextSharingControlMessageSchema = z.discriminatedUnion("type", [
  TextShareControlMessageSchema,
  TextShareAckControlMessageSchema,
  TextShareErrorControlMessageSchema
]);

export type TextSharePayload = z.infer<typeof TextSharePayloadSchema>;
export type TextShareAckPayload = z.infer<typeof TextShareAckPayloadSchema>;
export type TextShareErrorPayload = z.infer<typeof TextShareErrorPayloadSchema>;
export type TextSharingControlMessage = z.infer<typeof TextSharingControlMessageSchema>;

export function isValidHttpUrl(text: string): boolean {
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

/**
 * Auto-detects content type based on whether text starts with http:// or https://.
 */
export function detectContentType(text: string): "text" | "url" {
  return isValidHttpUrl(text) ? "url" : "text";
}

export const isUrl = isValidHttpUrl;
