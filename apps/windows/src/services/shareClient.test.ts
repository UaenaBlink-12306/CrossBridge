import { describe, expect, it } from "vitest";
import { generateDevelopmentKeyPair } from "@crossbridge/crypto";
import { MessageType } from "@crossbridge/protocol";
import {
  createTextShareAckEnvelope,
  createTextShareEnvelope,
  decodeShareEnvelope,
  relayAckFailureMessage
} from "./shareClient.js";
import {
  addReceivedShare,
  addSendingShare,
  createEmptyShareHistory,
  markShareFailed,
  markShareReceived,
  markShareSent
} from "./shareStore.js";
import { ReplayProtector } from "./replayProtection.js";
import type { TrustedDevice } from "@crossbridge/protocol";

const pixel: TrustedDevice = {
  deviceId: "android_pixel",
  deviceName: "Pixel",
  platform: "android",
  publicKey: "android_public_key",
  pairedAt: 1_000
};

describe("share client helpers", () => {
  it("creates and decodes URL text share envelopes", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const created = await createTextShareEnvelope({
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      text: "https://example.com",
      now: 2_000,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(created.envelope.fromDeviceId).toBe("pc_xxx");
    expect(created.envelope.toDeviceId).toBe("android_xxx");
    expect(created.envelope.ciphertext).not.toContain("https://example.com");
    expect(() => JSON.parse(atob(created.envelope.ciphertext))).toThrow();
    expect(created.payload.contentType).toBe("url");

    const decoded = await decodeShareEnvelope({
      envelope: created.envelope,
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });
    expect(decoded?.controlMessage).toEqual({
      type: MessageType.TEXT_SHARE,
      payload: created.payload
    });
  });

  it("creates text share acknowledgement envelopes", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const ack = await createTextShareAckEnvelope({
      fromDeviceId: "android_xxx",
      toDeviceId: "pc_xxx",
      shareId: "share_abc",
      now: 3_000,
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });
    const decoded = await decodeShareEnvelope({
      envelope: ack,
      localDeviceId: "pc_xxx",
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(decoded?.controlMessage).toMatchObject({
      type: MessageType.TEXT_SHARE_ACK,
      payload: {
        shareId: "share_abc",
        fromDeviceId: "android_xxx",
        toDeviceId: "pc_xxx",
        receivedAt: 3_000
      }
    });
  });

  it("rejects untrusted sender keys", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const stranger = await generateDevelopmentKeyPair();
    const created = await createTextShareEnvelope({
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      text: "hello",
      now: 2_000,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    await expect(decodeShareEnvelope({
      envelope: created.envelope,
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: stranger.publicKey
    })).resolves.toBeUndefined();
  });

  it("maps relay ACK failure reasons to user-safe messages", () => {
    expect(relayAckFailureMessage("DEVICE_OFFLINE")).toBe("Failed to send because the device is offline.");
    expect(relayAckFailureMessage("UNTRUSTED_DEVICE")).toBe("Failed to send because the device is not trusted yet.");
  });

});

describe("share store helpers", () => {
  it("tracks sent, acknowledged, failed, and received share history", () => {
    const history = addSendingShare(createEmptyShareHistory(), {
      shareId: "share_abc",
      messageId: "msg_abc",
      targetDevice: pixel,
      contentType: "text",
      text: "hello",
      createdAt: 1_000
    });

    expect(markShareSent(history, "msg_abc").sentShares[0]).toMatchObject({
      status: "sent",
      statusMessage: "Sent."
    });
    expect(markShareReceived(history, "share_abc").sentShares[0]).toMatchObject({
      status: "received",
      statusMessage: "Received."
    });
    expect(markShareFailed(history, "msg_abc", "Failed to send because the device is offline.").sentShares[0])
      .toMatchObject({
        status: "failed",
        statusMessage: "Failed to send because the device is offline."
      });

    const received = addReceivedShare(history, {
      shareId: "share_in",
      messageId: "msg_in",
      sourceDevice: pixel,
      contentType: "url",
      text: "https://example.com",
      receivedAt: 2_000
    });

    expect(received.receivedShares).toHaveLength(1);
    expect(addReceivedShare(received, received.receivedShares[0]).receivedShares).toHaveLength(1);
  });
});

describe("replay protection", () => {
  it("accepts an encrypted envelope once and rejects the replay", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const created = await createTextShareEnvelope({
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      text: "hello",
      now: 2_000,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });
    const protector = new ReplayProtector(undefined);

    expect(protector.accept(created.envelope)).toBe(true);
    expect(protector.accept(created.envelope)).toBe(false);
  });
});
