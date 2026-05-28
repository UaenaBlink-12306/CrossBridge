import {
  decryptAppMessage,
  encryptAppMessage,
  sha256Hex,
  type SecureAppMessage
} from "@crossbridge/crypto";
import {
  FILE_TRANSFER_DEFAULT_CHUNK_SIZE,
  FileTransferControlMessageSchema,
  MessageType,
  isRiskyFileName,
  parseEncryptedEnvelope,
  parseSecureAppMessage,
  summarizeRiskyFileWarning,
  type EncryptedEnvelopeInput,
  type FileAcceptPayload,
  type FileCancelPayload,
  type FileChunkPayload,
  type FileCompletePayload,
  type FileOfferPayload,
  type FileProgressPayload,
  type FileRejectPayload,
  type FileTransferControlMessage
} from "@crossbridge/protocol";

interface CryptoContext {
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}

interface TransferRoute extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  now?: number;
}

export interface FileChunkDescriptor {
  payload: FileChunkPayload;
  bytes: Uint8Array;
}

export interface CreatedFileOffer {
  transferId: string;
  payload: FileOfferPayload;
  envelope: EncryptedEnvelopeInput;
  chunks: FileChunkDescriptor[];
  riskyWarning?: string;
}

export interface DecodedFileTransferEnvelope {
  envelope: EncryptedEnvelopeInput;
  appMessage: SecureAppMessage;
  controlMessage: FileTransferControlMessage;
}

export function splitIntoFileChunks(
  transferId: string,
  bytes: Uint8Array,
  chunkSize = FILE_TRANSFER_DEFAULT_CHUNK_SIZE,
  fromDeviceId = "file_sender",
  toDeviceId = "file_receiver"
): FileChunkDescriptor[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive.");

  const totalChunks = Math.max(1, Math.ceil(bytes.length / chunkSize));
  return Array.from({ length: totalChunks }, (_, chunkIndex) => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(bytes.length, start + chunkSize);
    const chunkBytes = bytes.slice(start, end);
    return {
      bytes: chunkBytes,
      payload: {
        transferId,
        fromDeviceId,
        toDeviceId,
        chunkIndex,
        totalChunks,
        byteLength: chunkBytes.length,
        chunkHash: sha256Hex(chunkBytes),
        data: bytesToBase64(chunkBytes)
      }
    };
  });
}

export async function createFileOfferEnvelope(
  input: TransferRoute & {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
    direction: FileOfferPayload["direction"];
    transferId?: string;
    chunkSize?: number;
  }
): Promise<CreatedFileOffer> {
  const transferId = input.transferId ?? randomId("transfer");
  const now = input.now ?? Date.now();
  const payload: FileOfferPayload = {
    transferId,
    fileName: input.fileName,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    fileSize: input.bytes.length,
    mimeType: input.mimeType || "application/octet-stream",
    sha256: sha256Hex(input.bytes),
    direction: input.direction,
    createdAt: now
  };
  const chunks = splitIntoFileChunks(
    transferId,
    input.bytes,
    input.chunkSize,
    input.fromDeviceId,
    input.toDeviceId
  );

  return {
    transferId,
    payload,
    chunks,
    riskyWarning: summarizeRiskyFileWarning(input.fileName),
    envelope: await createRelayPayloadEnvelope({
      ...input,
      messageType: MessageType.FILE_OFFER,
      payload,
      now
    })
  };
}

export function createFileChunkEnvelope(
  input: TransferRoute & { payload: FileChunkPayload }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_CHUNK,
    payload: input.payload,
    now: input.now ?? Date.now()
  });
}

export function createFileAcceptEnvelope(
  input: TransferRoute & { transferId: string; accepted?: boolean }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_ACCEPT,
    payload: {
      transferId: input.transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      accepted: input.accepted ?? true,
      acceptedAt: input.now ?? Date.now()
    },
    now: input.now ?? Date.now()
  });
}

export function createFileRejectEnvelope(
  input: TransferRoute & { transferId: string; reason: string }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_REJECT,
    payload: {
      transferId: input.transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      reason: input.reason
    },
    now: input.now ?? Date.now()
  });
}

export function createFileProgressEnvelope(
  input: TransferRoute & { transferId: string; bytesTransferred: number; totalBytes: number }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_PROGRESS,
    payload: {
      transferId: input.transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      bytesTransferred: input.bytesTransferred,
      totalBytes: input.totalBytes
    },
    now: input.now ?? Date.now()
  });
}

export function createFileCompleteEnvelope(
  input: TransferRoute & { transferId: string; sha256: string }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_COMPLETE,
    payload: {
      transferId: input.transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      sha256: input.sha256,
      completedAt: input.now ?? Date.now()
    },
    now: input.now ?? Date.now()
  });
}

export function createFileCancelEnvelope(
  input: TransferRoute & { transferId: string }
): Promise<EncryptedEnvelopeInput> {
  return createRelayPayloadEnvelope({
    ...input,
    messageType: MessageType.FILE_CANCEL,
    payload: {
      transferId: input.transferId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId
    },
    now: input.now ?? Date.now()
  });
}

export async function decodeFileTransferEnvelope(input: CryptoContext & {
  envelope: unknown;
  localDeviceId: string;
}): Promise<DecodedFileTransferEnvelope | undefined> {
  let envelope: EncryptedEnvelopeInput;
  try {
    envelope = parseEncryptedEnvelope(input.envelope);
  } catch {
    return undefined;
  }

  try {
    const appMessage = parseSecureAppMessage(await decryptAppMessage({
      envelope,
      localDeviceId: input.localDeviceId,
      localPrivateKey: input.localPrivateKey,
      localPublicKey: input.localPublicKey,
      peerPublicKey: input.peerPublicKey
    }));
    return {
      envelope,
      appMessage,
      controlMessage: FileTransferControlMessageSchema.parse({
        type: appMessage.type,
        payload: appMessage.payload
      })
    };
  } catch {
    return undefined;
  }
}

export function reassembleTransferredFile(
  chunks: FileChunkPayload[],
  expectedSha256?: string
): Uint8Array {
  const sortedChunks = [...chunks].sort((left, right) => left.chunkIndex - right.chunkIndex);
  const bytes = concatChunks(sortedChunks.map((chunk) => {
    const chunkBytes = base64ToBytes(chunk.data ?? "");
    if (chunkBytes.length !== chunk.byteLength) {
      throw new Error(`Chunk ${chunk.chunkIndex} length did not match.`);
    }
    if (sha256Hex(chunkBytes) !== chunk.chunkHash) {
      throw new Error(`Chunk ${chunk.chunkIndex} SHA-256 did not match.`);
    }
    return chunkBytes;
  }));
  if (expectedSha256 && sha256Hex(bytes) !== expectedSha256) {
    throw new Error("Transferred file SHA-256 did not match.");
  }
  return bytes;
}

export function inferRiskyFileWarning(fileName: string): string | undefined {
  return isRiskyFileName(fileName) ? summarizeRiskyFileWarning(fileName) : undefined;
}

async function createRelayPayloadEnvelope(input: TransferRoute & {
  messageType: FileTransferControlMessage["type"];
  payload:
    | FileOfferPayload
    | FileAcceptPayload
    | FileRejectPayload
    | FileChunkPayload
    | FileProgressPayload
    | FileCompletePayload
    | FileCancelPayload;
  now: number;
}): Promise<EncryptedEnvelopeInput> {
  const appMessage: SecureAppMessage = {
    version: 1,
    id: randomId("msg"),
    type: input.messageType,
    timestamp: input.now,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    payload: input.payload
  };

  return encryptAppMessage({
    message: appMessage,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerPublicKey: input.peerPublicKey
  });
}

function randomId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}_${randomUuid.replaceAll("-", "")}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
