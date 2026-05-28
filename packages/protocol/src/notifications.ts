import { z } from "zod";
import { ErrorCodeSchema } from "./errors.js";
import { MessageType } from "./messageTypes.js";
import { TimestampSchema } from "./validators.js";

export const NotificationActionPayloadSchema = z.object({
  actionId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(128),
  supportsRemoteInput: z.boolean()
}).strict();

export const NotificationPostedPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256),
  packageName: z.string().trim().min(1).max(256),
  appName: z.string().trim().min(1).max(128),
  title: z.string().max(512).nullable(),
  text: z.string().max(4096).nullable(),
  subText: z.string().max(512).nullable(),
  postTime: TimestampSchema,
  canDismiss: z.boolean(),
  actions: z.array(NotificationActionPayloadSchema).max(16)
}).strict();

export const NotificationRemovedPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256)
}).strict();

export const NotificationDismissPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256)
}).strict();

export const NotificationReplyPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256),
  actionId: z.string().trim().min(1).max(128),
  replyText: z.string()
    .max(4096)
    .refine((value) => value.trim().length > 0, "replyText must not be blank")
}).strict();

export const NotificationDismissResultPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256),
  dismissed: z.boolean(),
  errorCode: ErrorCodeSchema.nullable().optional(),
  message: z.string().trim().min(1).max(512).nullable().optional()
}).strict();

export const NotificationReplyResultPayloadSchema = z.object({
  notificationId: z.string().trim().min(1).max(256),
  actionId: z.string().trim().min(1).max(128),
  replied: z.boolean(),
  errorCode: ErrorCodeSchema.nullable().optional(),
  message: z.string().trim().min(1).max(512).nullable().optional()
}).strict();

const notificationControlMessage = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  type: z.literal(type),
  payload
}).strict();

export const NotificationPostedControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_POSTED,
  NotificationPostedPayloadSchema
);

export const NotificationRemovedControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_REMOVED,
  NotificationRemovedPayloadSchema
);

export const NotificationDismissControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_DISMISS,
  NotificationDismissPayloadSchema
);

export const NotificationReplyControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_REPLY,
  NotificationReplyPayloadSchema
);

export const NotificationDismissResultControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_DISMISS_RESULT,
  NotificationDismissResultPayloadSchema
);

export const NotificationReplyResultControlMessageSchema = notificationControlMessage(
  MessageType.NOTIFICATION_REPLY_RESULT,
  NotificationReplyResultPayloadSchema
);

export const NotificationMirrorControlMessageSchema = z.discriminatedUnion("type", [
  NotificationPostedControlMessageSchema,
  NotificationRemovedControlMessageSchema,
  NotificationDismissControlMessageSchema,
  NotificationReplyControlMessageSchema,
  NotificationDismissResultControlMessageSchema,
  NotificationReplyResultControlMessageSchema
]);

export type NotificationActionPayload = z.infer<typeof NotificationActionPayloadSchema>;
export type NotificationPostedPayload = z.infer<typeof NotificationPostedPayloadSchema>;
export type NotificationRemovedPayload = z.infer<typeof NotificationRemovedPayloadSchema>;
export type NotificationDismissPayload = z.infer<typeof NotificationDismissPayloadSchema>;
export type NotificationReplyPayload = z.infer<typeof NotificationReplyPayloadSchema>;
export type NotificationDismissResultPayload = z.infer<typeof NotificationDismissResultPayloadSchema>;
export type NotificationReplyResultPayload = z.infer<typeof NotificationReplyResultPayloadSchema>;
export type NotificationMirrorControlMessage = z.infer<typeof NotificationMirrorControlMessageSchema>;
