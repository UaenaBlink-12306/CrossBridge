import {
  decryptAppMessage,
  encryptAppMessage,
  type SecureAppMessage
} from "@crossbridge/crypto";
import {
  MessageType,
  NotificationMirrorControlMessageSchema,
  parseEncryptedEnvelope,
  parseSecureAppMessage,
  type EncryptedEnvelopeInput,
  type NotificationDismissPayload,
  type NotificationDismissResultPayload,
  type NotificationMirrorControlMessage,
  type NotificationPostedPayload,
  type NotificationReplyPayload,
  type NotificationReplyResultPayload,
  type NotificationRemovedPayload
} from "@crossbridge/protocol";

interface CryptoContext {
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}

interface DecodeNotificationEnvelopeInput extends CryptoContext {
  envelope: unknown;
  localDeviceId: string;
}

interface CreateNotificationPostedEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationPostedPayload;
  now?: number;
}

interface CreateNotificationRemovedEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationRemovedPayload;
  now?: number;
}

interface CreateNotificationDismissEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationDismissPayload;
  now?: number;
}

interface CreateNotificationReplyEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationReplyPayload;
  now?: number;
}

interface CreateNotificationDismissResultEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationDismissResultPayload;
  now?: number;
}

interface CreateNotificationReplyResultEnvelopeInput extends CryptoContext {
  fromDeviceId: string;
  toDeviceId: string;
  payload: NotificationReplyResultPayload;
  now?: number;
}

export interface DecodedNotificationEnvelope {
  envelope: EncryptedEnvelopeInput;
  appMessage: SecureAppMessage;
  controlMessage: NotificationMirrorControlMessage;
}

export async function decodeNotificationEnvelope(
  input: DecodeNotificationEnvelopeInput
): Promise<DecodedNotificationEnvelope | undefined> {
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
      controlMessage: NotificationMirrorControlMessageSchema.parse({
        type: appMessage.type,
        payload: appMessage.payload
      })
    };
  } catch {
    return undefined;
  }
}

export async function createNotificationPostedEnvelope(
  input: CreateNotificationPostedEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_POSTED,
    payload: input.payload
  });
}

export async function createNotificationRemovedEnvelope(
  input: CreateNotificationRemovedEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_REMOVED,
    payload: input.payload
  });
}

export async function createNotificationDismissEnvelope(
  input: CreateNotificationDismissEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_DISMISS,
    payload: input.payload
  });
}

export async function createNotificationReplyEnvelope(
  input: CreateNotificationReplyEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_REPLY,
    payload: input.payload
  });
}

export async function createNotificationDismissResultEnvelope(
  input: CreateNotificationDismissResultEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_DISMISS_RESULT,
    payload: input.payload
  });
}

export async function createNotificationReplyResultEnvelope(
  input: CreateNotificationReplyResultEnvelopeInput
): Promise<EncryptedEnvelopeInput> {
  return createNotificationEnvelope({
    ...input,
    type: MessageType.NOTIFICATION_REPLY_RESULT,
    payload: input.payload
  });
}

async function createNotificationEnvelope(input: {
  fromDeviceId: string;
  toDeviceId: string;
  type:
    | MessageType.NOTIFICATION_POSTED
    | MessageType.NOTIFICATION_REMOVED
    | MessageType.NOTIFICATION_DISMISS
    | MessageType.NOTIFICATION_REPLY
    | MessageType.NOTIFICATION_DISMISS_RESULT
    | MessageType.NOTIFICATION_REPLY_RESULT;
  payload:
    | NotificationPostedPayload
    | NotificationRemovedPayload
    | NotificationDismissPayload
    | NotificationReplyPayload
    | NotificationDismissResultPayload
    | NotificationReplyResultPayload;
  now?: number;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}): Promise<EncryptedEnvelopeInput> {
  const now = input.now ?? Date.now();
  const appMessage: SecureAppMessage = {
    version: 1,
    id: randomId("msg"),
    type: input.type,
    timestamp: now,
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
