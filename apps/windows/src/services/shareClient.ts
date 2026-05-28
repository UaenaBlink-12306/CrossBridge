import {
  decryptAppMessage,
  encryptAppMessage,
  type SecureAppMessage
} from "@crossbridge/crypto";
import {
  MessageType,
  TextSharingControlMessageSchema,
  parseEncryptedEnvelope,
  parseSecureAppMessage,
  type EncryptedEnvelopeInput,
  type TextShareAckPayload,
  type TextShareErrorPayload,
  type TextSharePayload,
  type TextSharingControlMessage
} from "@crossbridge/protocol";

interface CryptoContext {
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}

interface CreateTextShareEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  text: string;
  now?: number;
}

interface CreateAckEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  shareId: string;
  now?: number;
}

interface CreateErrorEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId?: string;
  shareId?: string;
  errorCode: string;
  message: string;
  now?: number;
}

interface DecodeShareEnvelopeInput extends CryptoContext {
  envelope: unknown;
  localDeviceId: string;
}

export interface CreatedShareEnvelope {
  envelope: EncryptedEnvelopeInput;
  payload: TextSharePayload;
}

export interface DecodedShareEnvelope {
  envelope: EncryptedEnvelopeInput;
  appMessage: SecureAppMessage;
  controlMessage: TextSharingControlMessage;
}

export interface RelayAck {
  type: "RELAY_ACK";
  messageId: string;
  delivered: boolean;
  reason?: string;
}

export async function createTextShareEnvelope(input: CreateTextShareEnvelopeInput): Promise<CreatedShareEnvelope> {
  const now = input.now ?? Date.now();
  const payload: TextSharePayload = {
    shareId: randomId("share"),
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    contentType: detectContentType(input.text),
    text: input.text,
    createdAt: now
  };
  const controlMessage = TextSharingControlMessageSchema.parse({
    type: MessageType.TEXT_SHARE,
    payload
  });

  return {
    payload,
    envelope: await createRelayPayloadEnvelope({
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
      message: controlMessage,
      now,
      localPrivateKey: input.localPrivateKey,
      localPublicKey: input.localPublicKey,
      peerPublicKey: input.peerPublicKey
    })
  };
}

export async function createTextShareAckEnvelope(input: CreateAckEnvelopeInput): Promise<EncryptedEnvelopeInput> {
  const now = input.now ?? Date.now();
  const payload: TextShareAckPayload = {
    shareId: input.shareId,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    receivedAt: now
  };
  const controlMessage = TextSharingControlMessageSchema.parse({
    type: MessageType.TEXT_SHARE_ACK,
    payload
  });

  return createRelayPayloadEnvelope({
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    message: controlMessage,
    now,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerPublicKey: input.peerPublicKey
  });
}

export async function createTextShareErrorEnvelope(
  input: CreateErrorEnvelopeInput
): Promise<EncryptedEnvelopeInput | undefined> {
  if (!input.toDeviceId) return undefined;
  const now = input.now ?? Date.now();
  const payload: TextShareErrorPayload = {
    shareId: input.shareId,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    errorCode: input.errorCode,
    message: input.message
  };
  const controlMessage = TextSharingControlMessageSchema.parse({
    type: MessageType.TEXT_SHARE_ERROR,
    payload
  });

  return createRelayPayloadEnvelope({
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    message: controlMessage,
    now,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerPublicKey: input.peerPublicKey
  });
}

export async function decodeShareEnvelope(input: DecodeShareEnvelopeInput): Promise<DecodedShareEnvelope | undefined> {
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
      controlMessage: TextSharingControlMessageSchema.parse({
        type: appMessage.type,
        payload: appMessage.payload
      })
    };
  } catch {
    return undefined;
  }
}

export function isRelayAck(input: unknown): input is RelayAck {
  if (!isRecord(input)) return false;
  return input.type === "RELAY_ACK" &&
    typeof input.messageId === "string" &&
    typeof input.delivered === "boolean" &&
    (input.reason === undefined || typeof input.reason === "string");
}

export function relayAckFailureMessage(reason?: string): string {
  if (reason === "DEVICE_OFFLINE" || reason === "SOCKET_CLOSED") {
    return "Failed to send because the device is offline.";
  }

  if (reason === "UNTRUSTED_DEVICE") {
    return "Failed to send because the device is not trusted yet.";
  }

  return "Failed to send through the relay.";
}

async function createRelayPayloadEnvelope(input: {
  fromDeviceId: string;
  toDeviceId: string;
  message: TextSharingControlMessage;
  now: number;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}): Promise<EncryptedEnvelopeInput> {
  const appMessage: SecureAppMessage = {
    version: 1,
    id: randomId("msg"),
    type: input.message.type,
    timestamp: input.now,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    payload: input.message.payload
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

function detectContentType(text: string): "text" | "url" {
  return isValidHttpUrl(text) ? "url" : "text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
