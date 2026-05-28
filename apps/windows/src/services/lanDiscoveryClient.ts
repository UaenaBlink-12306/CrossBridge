import {
  LanDiscoveryProbeMessageSchema,
  MessageType,
  parseEncryptedEnvelope,
  parseSecureAppMessage,
  type EncryptedEnvelopeInput,
  type LanDiscoveryProbePayload
} from "@crossbridge/protocol";
import {
  decryptAppMessage,
  encryptAppMessage,
  type SecureAppMessage
} from "@crossbridge/crypto";

export async function createLanDiscoveryProbeEnvelope(input: {
  fromDeviceId: string;
  toDeviceId: string;
  localIps: string[];
  port: number;
  isReachable?: boolean;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
  now?: number;
}): Promise<EncryptedEnvelopeInput> {
  const now = input.now ?? Date.now();
  const payload: LanDiscoveryProbePayload = {
    deviceId: input.fromDeviceId,
    localIps: input.localIps,
    port: input.port,
    timestamp: now,
    isReachable: input.isReachable
  };
  const controlMessage = LanDiscoveryProbeMessageSchema.parse({
    type: MessageType.LAN_DISCOVERY_PROBE,
    payload
  });

  const appMessage: SecureAppMessage = {
    version: 1,
    id: `msg_${Math.random().toString(36).slice(2, 11)}`,
    type: controlMessage.type,
    timestamp: now,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    payload: controlMessage.payload
  };

  return encryptAppMessage({
    message: appMessage,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerPublicKey: input.peerPublicKey
  });
}

export async function decodeLanDiscoveryProbeEnvelope(input: {
  envelope: unknown;
  localDeviceId: string;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}): Promise<LanDiscoveryProbePayload | undefined> {
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

    if (appMessage.type !== MessageType.LAN_DISCOVERY_PROBE) {
      return undefined;
    }

    const controlMessage = LanDiscoveryProbeMessageSchema.parse({
      type: appMessage.type,
      payload: appMessage.payload
    });

    return controlMessage.payload;
  } catch {
    return undefined;
  }
}
