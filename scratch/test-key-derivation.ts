import { readFileSync } from "node:fs";
import {
  decryptAppMessage,
  encryptAppMessage,
  type EncryptedEnvelope,
  type SecureAppMessage
} from "@crossbridge/crypto";

// We copy the deriveKeyId logic to inspect what is generated
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = webcrypto;
}

// We copy the exact same helpers from index.ts to see what they return:
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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

async function deriveKeyId(input: {
  localDeviceId: string;
  localPublicKey: string;
  peerDeviceId: string;
  peerPublicKey: string;
}): Promise<string> {
  const data = new TextEncoder().encode(canonicalKeyParticipants(input));
  console.log("Canonical participants JSON:", canonicalKeyParticipants(input));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return bytesToBase64Url(digest).slice(0, 32);
}

async function run() {
  const windowsKeys = JSON.parse(readFileSync("scratch/windows_keys.json", "utf8"));
  const identityConfig = JSON.parse(readFileSync("scratch/android_identity.json", "utf8"));

  const keyIdWindowsPerspective = await deriveKeyId({
    localDeviceId: "windows_dev_test_id",
    localPublicKey: windowsKeys.publicKey,
    peerDeviceId: identityConfig.androidDeviceId,
    peerPublicKey: identityConfig.androidPublicKey
  });

  console.log("Windows perspective Key ID:", keyIdWindowsPerspective);
}

run().catch(console.error);
