import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ConnectionManager, type RelayClient } from "../src/websocket/connectionManager.js";
import {
  announceTrustedDeviceOffline,
  announceTrustedDeviceOnline,
  routeEncryptedEnvelope
} from "../src/websocket/messageRouter.js";

function fakeClient(deviceId: string) {
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(payload),
    close: () => undefined
  } as unknown as WebSocket;

  return {
    sent,
    client: {
      deviceId,
      socket,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
      trustedPeerIds: new Set<string>()
    } satisfies RelayClient
  };
}

describe("message router", () => {
  it("forwards only the encrypted envelope to the target device", () => {
    const manager = new ConnectionManager();
    const sender = fakeClient("pc_xxx");
    const recipient = fakeClient("android_xxx");
    manager.register(sender.client);
    manager.register(recipient.client);
    sender.client.trustedPeerIds.add("android_xxx");
    recipient.client.trustedPeerIds.add("pc_xxx");

    const envelope = {
      version: 1 as const,
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      messageId: "msg_xxx",
      timestamp: 1_779_100_000_000,
      nonce: "bm9uY2U=",
      ciphertext: "ZW5jcnlwdGVk"
    };

    const result = routeEncryptedEnvelope(manager, sender.client, envelope);

    expect(result.delivered).toBe(true);
    expect(recipient.sent).toHaveLength(1);
    expect(JSON.parse(recipient.sent[0] ?? "{}")).toEqual(envelope);
  });

  it("reports offline targets without storing plaintext", () => {
    const manager = new ConnectionManager();
    const sender = fakeClient("pc_xxx");
    manager.register(sender.client);

    const result = routeEncryptedEnvelope(manager, sender.client, {
      version: 1,
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      messageId: "msg_xxx",
      timestamp: 1_779_100_000_000,
      nonce: "bm9uY2U=",
      ciphertext: "ZW5jcnlwdGVk"
    });

    expect(result).toEqual({ delivered: false, reason: "DEVICE_OFFLINE" });
  });

  it("rejects connected targets that were not announced as trusted peers", () => {
    const manager = new ConnectionManager();
    const sender = fakeClient("pc_xxx");
    const recipient = fakeClient("android_xxx");
    manager.register(sender.client);
    manager.register(recipient.client);

    const result = routeEncryptedEnvelope(manager, sender.client, {
      version: 1,
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      messageId: "msg_xxx",
      timestamp: 1_779_100_000_000,
      nonce: "bm9uY2U=",
      ciphertext: "ZW5jcnlwdGVk"
    });

    expect(result).toEqual({ delivered: false, reason: "UNTRUSTED_DEVICE" });
    expect(recipient.sent).toHaveLength(0);
  });

  it("announces trusted-device presence only between mutually trusted peers", () => {
    const manager = new ConnectionManager();
    const pc = fakeClient("pc_xxx");
    const android = fakeClient("android_xxx");
    const stranger = fakeClient("android_stranger");

    manager.register(pc.client);
    manager.register(android.client);
    manager.register(stranger.client);
    manager.updateTrustedPresence("pc_xxx", {
      deviceId: "pc_xxx",
      deviceName: "PC",
      platform: "windows",
      publicKey: "pc_public_key"
    }, ["android_xxx"]);
    manager.updateTrustedPresence("android_xxx", {
      deviceId: "android_xxx",
      deviceName: "Pixel",
      platform: "android",
      publicKey: "android_public_key"
    }, ["pc_xxx"]);
    manager.updateTrustedPresence("android_stranger", {
      deviceId: "android_stranger",
      deviceName: "Unknown",
      platform: "android",
      publicKey: "stranger_public_key"
    }, []);

    announceTrustedDeviceOnline(manager, android.client, 2_000);

    expect(pc.sent).toHaveLength(1);
    expect(JSON.parse(pc.sent[0] ?? "{}")).toMatchObject({
      type: "TRUSTED_DEVICE_ONLINE",
      payload: {
        deviceIdentity: {
          deviceId: "android_xxx"
        },
        connectionMode: "relay",
        timestamp: 2_000
      }
    });
    expect(stranger.sent).toHaveLength(0);
  });

  it("announces trusted-device offline status to peers that trust the device", () => {
    const manager = new ConnectionManager();
    const pc = fakeClient("pc_xxx");
    const android = fakeClient("android_xxx");

    manager.register(pc.client);
    manager.register(android.client);
    manager.updateTrustedPresence("pc_xxx", {
      deviceId: "pc_xxx",
      deviceName: "PC",
      platform: "windows",
      publicKey: "pc_public_key"
    }, ["android_xxx"]);
    manager.updateTrustedPresence("android_xxx", {
      deviceId: "android_xxx",
      deviceName: "Pixel",
      platform: "android",
      publicKey: "android_public_key"
    }, ["pc_xxx"]);

    announceTrustedDeviceOffline(manager, android.client, 3_000);

    expect(pc.sent).toHaveLength(1);
    expect(JSON.parse(pc.sent[0] ?? "{}")).toEqual({
      type: "TRUSTED_DEVICE_OFFLINE",
      payload: {
        deviceId: "android_xxx",
        timestamp: 3_000
      }
    });
  });
});
