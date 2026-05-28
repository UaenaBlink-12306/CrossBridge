export type DeviceIdPrefix = "pc" | "android";

export interface DevelopmentKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface SecureAppMessage<TPayload = unknown> {
  version: 1;
  id: string;
  type: string;
  timestamp: number;
  fromDeviceId: string;
  toDeviceId: string;
  payload: TPayload;
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

export interface EncryptAppMessageInput<TPayload = unknown> {
  message: SecureAppMessage<TPayload>;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}

export interface DecryptAppMessageInput {
  envelope: EncryptedEnvelope;
  localDeviceId: string;
  localPrivateKey: string;
  localPublicKey: string;
  peerPublicKey: string;
}

export const APP_MESSAGE_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM";

const AES_GCM_KEY_LENGTH_BITS = 256;
const ECDH_NAMED_CURVE = "P-256";

export function createDeviceId(prefix: DeviceIdPrefix): string {
  const randomUuid = getCrypto().randomUUID?.() ?? fallbackUuid();
  const compactUuid = randomUuid.replaceAll("-", "").slice(0, 16);
  return `${prefix}_${compactUuid}`;
}

export function createPairingToken(): string {
  return bytesToBase64Url(randomBytes(18));
}

export function createNonce(byteLength = 12): string {
  return bytesToBase64(randomBytes(byteLength));
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(typeof input === "string" ? utf8Encode(input) : input));
}

export async function generateDevelopmentKeyPair(): Promise<DevelopmentKeyPair> {
  const keyPair = await subtle().generateKey(
    { name: "ECDH", namedCurve: ECDH_NAMED_CURVE },
    true,
    ["deriveBits", "deriveKey"]
  );
  const publicKey = await subtle().exportKey("spki", keyPair.publicKey);
  const privateKey = await subtle().exportKey("pkcs8", keyPair.privateKey);
  return {
    publicKey: bytesToBase64(new Uint8Array(publicKey)),
    privateKey: bytesToBase64(new Uint8Array(privateKey))
  };
}

export async function isValidDevelopmentKeyPair(keyPair: DevelopmentKeyPair): Promise<boolean> {
  try {
    await importPublicKey(keyPair.publicKey);
    await importPrivateKey(keyPair.privateKey);
    return true;
  } catch {
    return false;
  }
}

export async function encryptAppMessage<TPayload>(
  input: EncryptAppMessageInput<TPayload>
): Promise<EncryptedEnvelope> {
  const keyId = await deriveKeyId({
    localDeviceId: input.message.fromDeviceId,
    localPublicKey: input.localPublicKey,
    peerDeviceId: input.message.toDeviceId,
    peerPublicKey: input.peerPublicKey
  });
  const nonceBytes = randomBytes(12);
  const envelopeMetadata = {
    version: 1 as const,
    fromDeviceId: input.message.fromDeviceId,
    toDeviceId: input.message.toDeviceId,
    messageId: input.message.id,
    timestamp: input.message.timestamp,
    nonce: bytesToBase64(nonceBytes),
    algorithm: APP_MESSAGE_ALGORITHM,
    keyId
  };
  const key = await deriveAesGcmKey({
    localDeviceId: input.message.fromDeviceId,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerDeviceId: input.message.toDeviceId,
    peerPublicKey: input.peerPublicKey
  });
  const ciphertext = await subtle().encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonceBytes),
      additionalData: toArrayBuffer(utf8Encode(canonicalEnvelopeMetadata(envelopeMetadata))),
      tagLength: 128
    },
    key,
    toArrayBuffer(utf8Encode(JSON.stringify(input.message)))
  );

  return {
    ...envelopeMetadata,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptAppMessage(
  input: DecryptAppMessageInput
): Promise<SecureAppMessage> {
  if (input.envelope.algorithm !== APP_MESSAGE_ALGORITHM) {
    throw new Error("Unsupported encrypted envelope algorithm.");
  }

  const peerDeviceId = input.envelope.fromDeviceId === input.localDeviceId
    ? input.envelope.toDeviceId
    : input.envelope.fromDeviceId;
  const expectedKeyId = await deriveKeyId({
    localDeviceId: input.localDeviceId,
    localPublicKey: input.localPublicKey,
    peerDeviceId,
    peerPublicKey: input.peerPublicKey
  });
  if (input.envelope.keyId !== expectedKeyId) {
    throw new Error("Encrypted envelope key id did not match the trusted peer.");
  }

  const key = await deriveAesGcmKey({
    localDeviceId: input.localDeviceId,
    localPrivateKey: input.localPrivateKey,
    localPublicKey: input.localPublicKey,
    peerDeviceId,
    peerPublicKey: input.peerPublicKey
  });

  const plaintext = await subtle().decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(input.envelope.nonce)),
      additionalData: toArrayBuffer(utf8Encode(canonicalEnvelopeMetadata({
        version: input.envelope.version,
        fromDeviceId: input.envelope.fromDeviceId,
        toDeviceId: input.envelope.toDeviceId,
        messageId: input.envelope.messageId,
        timestamp: input.envelope.timestamp,
        nonce: input.envelope.nonce,
        algorithm: input.envelope.algorithm,
        keyId: input.envelope.keyId
      }))),
      tagLength: 128
    },
    key,
    toArrayBuffer(base64ToBytes(input.envelope.ciphertext))
  );
  const parsed = JSON.parse(utf8Decode(new Uint8Array(plaintext))) as SecureAppMessage;
  if (
    parsed.version !== 1 ||
    parsed.id !== input.envelope.messageId ||
    parsed.fromDeviceId !== input.envelope.fromDeviceId ||
    parsed.toDeviceId !== input.envelope.toDeviceId
  ) {
    throw new Error("Decrypted app message did not match its envelope metadata.");
  }
  return parsed;
}

async function deriveAesGcmKey(input: {
  localDeviceId: string;
  localPrivateKey: string;
  localPublicKey: string;
  peerDeviceId: string;
  peerPublicKey: string;
}): Promise<CryptoKey> {
  const privateKey = await importPrivateKey(input.localPrivateKey);
  const peerPublicKey = await importPublicKey(input.peerPublicKey);
  const sharedSecret = await subtle().deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    AES_GCM_KEY_LENGTH_BITS
  );
  const hkdfKey = await subtle().importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(await hashAsync(utf8Encode(canonicalKeyParticipants(input)))),
      info: toArrayBuffer(utf8Encode("CrossBridge app-message AES-GCM key v1"))
    },
    hkdfKey,
    { name: "AES-GCM", length: AES_GCM_KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveKeyId(input: {
  localDeviceId: string;
  localPublicKey: string;
  peerDeviceId: string;
  peerPublicKey: string;
}): Promise<string> {
  const digest = await hashAsync(utf8Encode(canonicalKeyParticipants(input)));
  return bytesToBase64Url(digest).slice(0, 32);
}

function canonicalKeyParticipants(input: {
  localDeviceId: string;
  localPublicKey: string;
  peerDeviceId: string;
  peerPublicKey: string;
}): string {
  const participants = [
    { deviceId: input.localDeviceId, publicKey: input.localPublicKey },
    { deviceId: input.peerDeviceId, publicKey: input.peerPublicKey }
  ].sort((left, right) => left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0);
  return JSON.stringify({ version: 1, participants });
}

function canonicalEnvelopeMetadata(input: {
  version: 1;
  fromDeviceId: string;
  toDeviceId: string;
  messageId: string;
  timestamp: number;
  nonce: string;
  algorithm?: string;
  keyId?: string;
}): string {
  return JSON.stringify({
    version: input.version,
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    messageId: input.messageId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    algorithm: input.algorithm,
    keyId: input.keyId
  });
}

async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  return subtle().importKey(
    "spki",
    toArrayBuffer(base64ToBytes(publicKey)),
    { name: "ECDH", namedCurve: ECDH_NAMED_CURVE },
    true,
    []
  );
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return subtle().importKey(
    "pkcs8",
    toArrayBuffer(base64ToBytes(privateKey)),
    { name: "ECDH", namedCurve: ECDH_NAMED_CURVE },
    true,
    ["deriveBits", "deriveKey"]
  );
}

async function hashAsync(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", toArrayBuffer(bytes)));
}

function subtle(): SubtleCrypto {
  const crypto = getCrypto();
  if (!crypto.subtle) {
    throw new Error("Web Crypto is required for CrossBridge app-message encryption.");
  }
  return crypto.subtle;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new Error("Web Crypto is not available.");
  }
  return globalThis.crypto;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function utf8Decode(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const constants = [
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
  ];
  const words = new Array<number>(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
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
  hash.forEach((word, index) => outputView.setUint32(index * 4, word));
  return output;
}

function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
