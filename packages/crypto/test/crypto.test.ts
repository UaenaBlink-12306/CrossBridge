import { describe, expect, it } from "vitest";
import {
  APP_MESSAGE_ALGORITHM,
  createDeviceId,
  createNonce,
  createPairingToken,
  decryptAppMessage,
  encryptAppMessage,
  generateDevelopmentKeyPair,
  sha256Hex
} from "../src/index.js";

describe("crypto helpers", () => {
  it("creates scoped device identifiers", () => {
    expect(createDeviceId("pc")).toMatch(/^pc_[a-f0-9]{16}$/);
    expect(createDeviceId("android")).toMatch(/^android_[a-f0-9]{16}$/);
  });

  it("creates non-empty pairing tokens and nonces", () => {
    expect(createPairingToken()).toHaveLength(24);
    expect(createNonce()).toBeTruthy();
  });

  it("hashes bytes with SHA-256", () => {
    expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("encrypts and decrypts app messages with ECDH-derived AES-GCM", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const message = {
      version: 1 as const,
      id: "msg_roundtrip",
      type: "TEXT_SHARE",
      timestamp: 2_000,
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      payload: {
        text: "hello from Windows"
      }
    };

    const envelope = await encryptAppMessage({
      message,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(envelope.algorithm).toBe(APP_MESSAGE_ALGORITHM);
    expect(envelope.ciphertext).not.toContain("hello from Windows");
    expect(() => JSON.parse(atob(envelope.ciphertext))).toThrow();

    await expect(decryptAppMessage({
      envelope,
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    })).resolves.toEqual(message);
  });

  it("rejects wrong keys and tampered ciphertext", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const stranger = await generateDevelopmentKeyPair();
    const envelope = await encryptAppMessage({
      message: {
        version: 1,
        id: "msg_tamper",
        type: "TEXT_SHARE",
        timestamp: 2_000,
        fromDeviceId: "pc_xxx",
        toDeviceId: "android_xxx",
        payload: { text: "secret" }
      },
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    await expect(decryptAppMessage({
      envelope,
      localDeviceId: "android_xxx",
      localPrivateKey: stranger.privateKey,
      localPublicKey: stranger.publicKey,
      peerPublicKey: pc.publicKey
    })).rejects.toThrow();

    await expect(decryptAppMessage({
      envelope: {
        ...envelope,
        ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`
      },
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    })).rejects.toThrow();
  });
});
