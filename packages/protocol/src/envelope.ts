import type { MessageType } from "./messageTypes.js";

export interface BaseMessage<TPayload = unknown> {
  version: 1;
  id: string;
  type: MessageType;
  timestamp: number;
  payload: TPayload;
}

export interface SecureAppMessage<TPayload = unknown> extends BaseMessage<TPayload> {
  fromDeviceId: string;
  toDeviceId: string;
}

export interface EncryptedEnvelope {
  version: 1;
  fromDeviceId: string;
  toDeviceId: string;
  messageId: string;
  timestamp: number;
  nonce: string;
  ciphertext: string;
  algorithm?: string;
  keyId?: string;
}

export interface FileChunkMetadata {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  byteLength: number;
  chunkHash: string;
}
