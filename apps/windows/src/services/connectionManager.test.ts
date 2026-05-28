import { describe, expect, it } from "vitest";
import {
  ConnectionManager,
  applyTrustedDeviceOffline,
  applyTrustedDeviceOnline,
  applyTrustedDeviceStatus,
  createTrustedDeviceConnections
} from "./connectionManager.js";
import { reconnectDelayMs } from "./relayClient.js";
import type { DeviceIdentity, TrustedDevice } from "@crossbridge/protocol";

const pixel: TrustedDevice = {
  deviceId: "android_pixel",
  deviceName: "Pixel",
  platform: "android",
  publicKey: "android_public_key",
  pairedAt: 1_000,
  lastSeenAt: 1_500
};

const updatedPixelIdentity: DeviceIdentity = {
  deviceId: "android_pixel",
  deviceName: "Pixel 8",
  platform: "android",
  publicKey: "android_public_key"
};

describe("connection manager helpers", () => {
  it("creates offline status entries from trusted devices", () => {
    expect(createTrustedDeviceConnections([pixel])).toEqual([
      {
        device: pixel,
        online: false,
        lastSeenAt: pixel.lastSeenAt
      }
    ]);
  });

  it("marks only trusted matching devices online", () => {
    const connections = createTrustedDeviceConnections([pixel]);
    const next = applyTrustedDeviceOnline(connections, updatedPixelIdentity, 2_000);

    expect(next).toEqual([
      {
        device: {
          ...pixel,
          deviceName: "Pixel 8",
          lastSeenAt: 2_000
        },
        online: true,
        connectionMode: "relay",
        lastSeenAt: 2_000
      }
    ]);

    expect(applyTrustedDeviceOnline(connections, {
      ...updatedPixelIdentity,
      deviceId: "android_unknown"
    }, 3_000)).toEqual(connections);
  });

  it("marks trusted devices offline and applies status updates", () => {
    const online = applyTrustedDeviceOnline(
      createTrustedDeviceConnections([pixel]),
      updatedPixelIdentity,
      2_000
    );

    expect(applyTrustedDeviceOffline(online, pixel.deviceId, 3_000)[0]).toMatchObject({
      online: false,
      connectionMode: undefined,
      lastSeenAt: 3_000
    });

    expect(applyTrustedDeviceStatus(online, pixel.deviceId, false, 4_000)[0]).toMatchObject({
      online: false,
      connectionMode: undefined,
      lastSeenAt: 4_000
    });
  });

  it("uses bounded reconnect backoff delays", () => {
    expect([1, 2, 3, 4, 5, 12].map(reconnectDelayMs)).toEqual([
      1_000,
      2_000,
      5_000,
      10_000,
      30_000,
      30_000
    ]);
  });
});

describe("ConnectionManager file transfers", () => {
  it("initializes empty transfers list", () => {
    const mgr = new ConnectionManager();
    expect(mgr.getState().transfers).toEqual([]);
  });

  it("throws offline error when trying to send a file offer to an offline device", async () => {
    const mgr = new ConnectionManager();
    const bytes = new TextEncoder().encode("file content");
    await expect(mgr.sendFileOffer("android_pixel", "notes.txt", "text/plain", bytes))
      .rejects.toThrow(/device is not trusted yet/);
  });
});

