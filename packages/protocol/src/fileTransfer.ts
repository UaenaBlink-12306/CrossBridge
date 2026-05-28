import { z } from "zod";
import { MessageType } from "./messageTypes.js";
import {
  FileAcceptMessageSchema,
  FileCancelMessageSchema,
  FileChunkMessageSchema,
  FileCompleteMessageSchema,
  FileOfferMessageSchema,
  FileProgressMessageSchema,
  FileRejectMessageSchema,
  isRiskyFileName
} from "./validators.js";

export const FILE_TRANSFER_DEFAULT_CHUNK_SIZE = 64 * 1024;

export const FileDirectionSchema = z.enum([
  "ANDROID_TO_WINDOWS",
  "WINDOWS_TO_ANDROID"
]);

const fileTransferControlMessage = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  type: z.literal(type),
  payload
}).strict();

export const FileOfferControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_OFFER,
  FileOfferMessageSchema.shape.payload
);

export const FileAcceptControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_ACCEPT,
  FileAcceptMessageSchema.shape.payload
);

export const FileRejectControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_REJECT,
  FileRejectMessageSchema.shape.payload
);

export const FileChunkControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_CHUNK,
  FileChunkMessageSchema.shape.payload
);

export const FileProgressControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_PROGRESS,
  FileProgressMessageSchema.shape.payload
);

export const FileCompleteControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_COMPLETE,
  FileCompleteMessageSchema.shape.payload
);

export const FileCancelControlMessageSchema = fileTransferControlMessage(
  MessageType.FILE_CANCEL,
  FileCancelMessageSchema.shape.payload
);

export const FileTransferControlMessageSchema = z.discriminatedUnion("type", [
  FileOfferControlMessageSchema,
  FileAcceptControlMessageSchema,
  FileRejectControlMessageSchema,
  FileChunkControlMessageSchema,
  FileProgressControlMessageSchema,
  FileCompleteControlMessageSchema,
  FileCancelControlMessageSchema
]);

export type FileDirection = z.infer<typeof FileDirectionSchema>;
export type FileOfferPayload = z.infer<typeof FileOfferMessageSchema>["payload"];
export type FileAcceptPayload = z.infer<typeof FileAcceptMessageSchema>["payload"];
export type FileRejectPayload = z.infer<typeof FileRejectMessageSchema>["payload"];
export type FileChunkPayload = z.infer<typeof FileChunkMessageSchema>["payload"];
export type FileProgressPayload = z.infer<typeof FileProgressMessageSchema>["payload"];
export type FileCompletePayload = z.infer<typeof FileCompleteMessageSchema>["payload"];
export type FileCancelPayload = z.infer<typeof FileCancelMessageSchema>["payload"];
export type FileTransferControlMessage = z.infer<typeof FileTransferControlMessageSchema>;

export function summarizeRiskyFileWarning(fileName: string): string | undefined {
  if (!isRiskyFileName(fileName)) return undefined;
  return `Potentially risky file type: ${fileName}`;
}

export function assessFileRisk(fileName: string): { risky: boolean; warning?: string } {
  const warning = summarizeRiskyFileWarning(fileName);
  return {
    risky: warning !== undefined,
    warning
  };
}
