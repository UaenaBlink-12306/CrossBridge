import { z } from "zod";
import { MessageType } from "./messageTypes.js";
import { Base64Schema, DeviceIdSchema, TimestampSchema } from "./validators.js";

const PairingSessionIdSchema = z.string().trim().min(8).max(128);
const PairingTokenSchema = z.string().trim().min(8).max(512);
const VerificationCodeSchema = z.string().regex(/^[0-9]{6}$/);

export const DevicePlatformSchema = z.enum(["windows", "android"]);

export const DeviceIdentitySchema = z.object({
  deviceId: DeviceIdSchema,
  deviceName: z.string().trim().min(1).max(128),
  platform: DevicePlatformSchema,
  publicKey: Base64Schema
}).strict();

export const TrustedDeviceSchema = DeviceIdentitySchema.extend({
  pairedAt: TimestampSchema,
  lastSeenAt: TimestampSchema.optional()
}).strict();

export const PairingQrPayloadSchema = z.object({
  protocol: z.literal("crossbridge-v1"),
  pairingSessionId: PairingSessionIdSchema,
  relayUrl: z.string().trim().min(1).max(2048).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "ws:" || url.protocol === "wss:";
    } catch {
      return false;
    }
  }, "relayUrl must be a ws:// or wss:// URL"),
  pcDeviceId: DeviceIdSchema,
  pcDeviceName: z.string().trim().min(1).max(128),
  pcPublicKey: Base64Schema,
  pairingToken: PairingTokenSchema,
  expiresAt: TimestampSchema
}).strict();

export const PairingSessionCreatePayloadSchema = z.object({
  deviceIdentity: DeviceIdentitySchema.refine(
    (identity) => identity.platform === "windows",
    "Pairing sessions must be created by a Windows identity"
  )
}).strict();

export const PairingSessionCreatedPayloadSchema = z.object({
  qrPayload: PairingQrPayloadSchema
}).strict();

export const PairingJoinPayloadSchema = z.object({
  pairingSessionId: PairingSessionIdSchema,
  pairingToken: PairingTokenSchema,
  deviceIdentity: DeviceIdentitySchema.refine(
    (identity) => identity.platform === "android",
    "Pairing joins must use an Android identity"
  )
}).strict();

export const PairingJoinedPayloadSchema = z.object({
  pairingSessionId: PairingSessionIdSchema,
  pcIdentity: DeviceIdentitySchema.refine((identity) => identity.platform === "windows"),
  androidIdentity: DeviceIdentitySchema.refine((identity) => identity.platform === "android"),
  verificationCode: VerificationCodeSchema
}).strict();

export const PairingConfirmPayloadSchema = z.object({
  pairingSessionId: PairingSessionIdSchema,
  deviceId: DeviceIdSchema
}).strict();

export const PairingCompletePayloadSchema = z.object({
  pairingSessionId: PairingSessionIdSchema,
  trustedDevices: z.array(TrustedDeviceSchema).min(2).max(2)
}).strict();

export const PairingExpiredPayloadSchema = z.object({
  pairingSessionId: PairingSessionIdSchema,
  expiresAt: TimestampSchema
}).strict();

const pairingControlMessage = <TType extends MessageType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) => z.object({
  type: z.literal(type),
  payload
}).strict();

export const PairingSessionCreateControlMessageSchema = pairingControlMessage(
  MessageType.PAIRING_SESSION_CREATE,
  PairingSessionCreatePayloadSchema
);

export const PairingJoinControlMessageSchema = pairingControlMessage(
  MessageType.PAIRING_JOIN,
  PairingJoinPayloadSchema
);

export const PairingConfirmControlMessageSchema = pairingControlMessage(
  MessageType.PAIRING_CONFIRM,
  PairingConfirmPayloadSchema
);

export const PairingControlMessageSchema = z.discriminatedUnion("type", [
  PairingSessionCreateControlMessageSchema,
  PairingJoinControlMessageSchema,
  PairingConfirmControlMessageSchema
]);

const SHA256_INITIAL_HASH = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
] as const;

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(input: string): Uint8Array {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash: number[] = [...SHA256_INITIAL_HASH];
  const words = new Array<number>(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }

    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15];
      const word2 = words[index - 2];
      const s0 = rightRotate(word15, 7) ^ rightRotate(word15, 18) ^ (word15 >>> 3);
      const s1 = rightRotate(word2, 17) ^ rightRotate(word2, 19) ^ (word2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  hash.forEach((word, index) => {
    outputView.setUint32(index * 4, word);
  });
  return output;
}

export function derivePairingCode(
  pcPublicKey: string,
  androidPublicKey: string,
  pairingSessionId: string
): string {
  const hash = sha256(
    JSON.stringify({
      version: 1,
      pcPublicKey,
      androidPublicKey,
      pairingSessionId
    })
  );
  const numericCode = new DataView(hash.buffer).getUint32(0) % 1_000_000;
  return numericCode.toString().padStart(6, "0");
}

export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;
export type TrustedDevice = z.infer<typeof TrustedDeviceSchema>;
export type PairingQrPayload = z.infer<typeof PairingQrPayloadSchema>;
export type PairingSessionCreatePayload = z.infer<typeof PairingSessionCreatePayloadSchema>;
export type PairingSessionCreatedPayload = z.infer<typeof PairingSessionCreatedPayloadSchema>;
export type PairingJoinPayload = z.infer<typeof PairingJoinPayloadSchema>;
export type PairingJoinedPayload = z.infer<typeof PairingJoinedPayloadSchema>;
export type PairingConfirmPayload = z.infer<typeof PairingConfirmPayloadSchema>;
export type PairingCompletePayload = z.infer<typeof PairingCompletePayloadSchema>;
export type PairingExpiredPayload = z.infer<typeof PairingExpiredPayloadSchema>;
export type PairingControlMessage = z.infer<typeof PairingControlMessageSchema>;
