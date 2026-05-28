import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRelayServer } from "../src/index.js";
import { MockAndroidPairingClient } from "../test-clients/mockAndroidPairingClient.js";
import { MockPcPairingClient } from "../test-clients/mockPcPairingClient.js";

function receiveJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("relay integration", () => {
  it("connects two mock clients and forwards an encrypted envelope", async () => {
    const relay = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      maxPayloadBytes: 2_000_000,
      heartbeatIntervalMs: 60_000,
      sessionTokenMinLength: 8,
      pairingSessionTtlMs: 120_000,
      pairingCleanupIntervalMs: 60_000
    });

    await relay.start();
    const address = relay.app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${address.port}/connect`;

    const pc = new WebSocket(url);
    const phone = new WebSocket(url);

    await Promise.all([once(pc, "open"), once(phone, "open")]);

    pc.send(JSON.stringify({
      type: "RELAY_HELLO",
      deviceId: "pc_xxx",
      sessionToken: "token_pc_xxx",
      protocolVersion: 1
    }));
    phone.send(JSON.stringify({
      type: "RELAY_HELLO",
      deviceId: "android_xxx",
      sessionToken: "token_android_xxx",
      protocolVersion: 1
    }));

    await Promise.all([receiveJson(pc), receiveJson(phone)]);

    pc.send(JSON.stringify({
      type: "TRUSTED_DEVICE_HELLO",
      payload: {
        deviceIdentity: {
          deviceId: "pc_xxx",
          deviceName: "PC",
          platform: "windows",
          publicKey: "pc_public_key"
        },
        trustedPeerIds: ["android_xxx"]
      }
    }));
    const pcOnlineMessage = receiveJson(pc);
    const phoneOnlineMessage = receiveJson(phone);
    phone.send(JSON.stringify({
      type: "TRUSTED_DEVICE_HELLO",
      payload: {
        deviceIdentity: {
          deviceId: "android_xxx",
          deviceName: "Pixel",
          platform: "android",
          publicKey: "android_public_key"
        },
        trustedPeerIds: ["pc_xxx"]
      }
    }));

    await Promise.all([pcOnlineMessage, phoneOnlineMessage]);

    const envelope = {
      version: 1,
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      messageId: "msg_xxx",
      timestamp: 1_779_100_000_000,
      nonce: "bm9uY2U=",
      ciphertext: "ZW5jcnlwdGVk"
    };

    const forwarded = receiveJson(phone);
    pc.send(JSON.stringify(envelope));

    await expect(forwarded).resolves.toEqual(envelope);

    pc.close();
    phone.close();
    await relay.stop();
  }, 30_000);

  it("reports trusted peers online through relay presence messages", async () => {
    const relay = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      maxPayloadBytes: 2_000_000,
      heartbeatIntervalMs: 60_000,
      sessionTokenMinLength: 8,
      pairingSessionTtlMs: 120_000,
      pairingCleanupIntervalMs: 60_000
    });

    await relay.start();
    const address = relay.app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${address.port}/connect`;

    const pc = new WebSocket(url);
    const phone = new WebSocket(url);

    try {
      await Promise.all([once(pc, "open"), once(phone, "open")]);

      pc.send(JSON.stringify({
        type: "RELAY_HELLO",
        deviceId: "pc_xxx",
        sessionToken: "token_pc_xxx",
        protocolVersion: 1
      }));
      phone.send(JSON.stringify({
        type: "RELAY_HELLO",
        deviceId: "android_xxx",
        sessionToken: "token_android_xxx",
        protocolVersion: 1
      }));

      await Promise.all([receiveJson(pc), receiveJson(phone)]);

      pc.send(JSON.stringify({
        type: "TRUSTED_DEVICE_HELLO",
        payload: {
          deviceIdentity: {
            deviceId: "pc_xxx",
            deviceName: "PC",
            platform: "windows",
            publicKey: "pc_public_key"
          },
          trustedPeerIds: ["android_xxx"]
        }
      }));
      const pcOnlineMessage = receiveJson(pc);
      const phoneOnlineMessage = receiveJson(phone);
      phone.send(JSON.stringify({
        type: "TRUSTED_DEVICE_HELLO",
        payload: {
          deviceIdentity: {
            deviceId: "android_xxx",
            deviceName: "Pixel",
            platform: "android",
            publicKey: "android_public_key"
          },
          trustedPeerIds: ["pc_xxx"]
        }
      }));

      await expect(pcOnlineMessage).resolves.toMatchObject({
        type: "TRUSTED_DEVICE_ONLINE",
        payload: {
          deviceIdentity: {
            deviceId: "android_xxx"
          },
          connectionMode: "relay"
        }
      });
      await expect(phoneOnlineMessage).resolves.toMatchObject({
        type: "TRUSTED_DEVICE_ONLINE",
        payload: {
          deviceIdentity: {
            deviceId: "pc_xxx"
          },
          connectionMode: "relay"
        }
      });
    } finally {
      pc.close();
      phone.close();
      await relay.stop();
    }
  });

  it("completes PC and Android pairing entirely over relay mode", async () => {
    const relay = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      maxPayloadBytes: 2_000_000,
      heartbeatIntervalMs: 60_000,
      sessionTokenMinLength: 8,
      pairingSessionTtlMs: 120_000,
      pairingCleanupIntervalMs: 60_000
    });

    await relay.start();
    const address = relay.app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${address.port}/connect`;
    const pc = new MockPcPairingClient();
    const android = new MockAndroidPairingClient();

    try {
      await pc.connect(url);
      const qrPayload = await pc.createPairingSession();

      expect(qrPayload.relayUrl).toBe(url);
      expect(qrPayload.pcDeviceId).toBe(pc.identity.deviceId);
      expect(qrPayload.pcPublicKey).toBe(pc.identity.publicKey);

      await android.connect(qrPayload.relayUrl);
      const pcJoinedPromise = pc.waitForJoined();
      const androidJoined = await android.joinPairingSession(qrPayload);
      const pcJoined = await pcJoinedPromise;

      expect(androidJoined.verificationCode).toBe(pcJoined.verificationCode);
      expect(androidJoined.verificationCode).toMatch(/^[0-9]{6}$/);
      expect(pcJoined.pcIdentity).toEqual(pc.identity);
      expect(androidJoined.androidIdentity).toEqual(android.identity);

      const pcCompletePromise = pc.waitForComplete();
      const androidCompletePromise = android.waitForComplete();
      pc.confirm(qrPayload.pairingSessionId);
      android.confirm(qrPayload.pairingSessionId);

      const [pcComplete, androidComplete] = await Promise.all([
        pcCompletePromise,
        androidCompletePromise
      ]);

      expect(pcComplete).toEqual(androidComplete);
      expect(pc.trustedDevices.get(android.identity.deviceId)).toMatchObject({
        deviceId: android.identity.deviceId,
        publicKey: android.identity.publicKey
      });
      expect(android.trustedDevices.get(pc.identity.deviceId)).toMatchObject({
        deviceId: pc.identity.deviceId,
        publicKey: pc.identity.publicKey
      });
    } finally {
      pc.close();
      android.close();
      await relay.stop();
    }
  });
});
