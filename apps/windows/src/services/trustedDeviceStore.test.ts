import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrustedDeviceStore } from "./trustedDeviceStore.js";
import type { TrustedDevice } from "@crossbridge/protocol";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setRaw(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storageKey = "crossbridge.trustedDevices.v1";

const pixel: TrustedDevice = {
  deviceId: "android_pixel",
  deviceName: "Pixel",
  platform: "android",
  publicKey: "YW5kcm9pZC1wdWJsaWMta2V5",
  pairedAt: 1_000
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trustedDeviceStore", () => {
  it("saves, loads, removes, and clears devices through the async browser fallback", async () => {
    const storage = new MemoryStorage();
    const store = createTrustedDeviceStore(storage);

    await store.saveTrustedDevice(pixel);
    expect(await store.loadTrustedDevices()).toEqual([pixel]);

    await store.removeTrustedDevice(pixel.deviceId);
    expect(await store.loadTrustedDevices()).toEqual([]);

    await store.saveTrustedDevice(pixel);
    await store.clearTrustedDevices();
    expect(await store.loadTrustedDevices()).toEqual([]);
  });

  it("deduplicates devices by deviceId and refreshes lastSeenAt", async () => {
    const storage = new MemoryStorage();
    const store = createTrustedDeviceStore(storage);

    await store.saveTrustedDevice(pixel);
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    await store.saveTrustedDevice({
      ...pixel,
      deviceName: "Pixel 8"
    });

    expect(await store.loadTrustedDevices()).toEqual([
      {
        ...pixel,
        deviceName: "Pixel 8",
        lastSeenAt: 5_000
      }
    ]);
  });

  it("ignores malformed stored entries safely", async () => {
    const storage = new MemoryStorage();
    const store = createTrustedDeviceStore(storage);

    storage.setRaw(storageKey, JSON.stringify([
      pixel,
      { ...pixel, deviceId: "" },
      { deviceId: "android_bad" },
      "not-a-device"
    ]));

    expect(await store.loadTrustedDevices()).toEqual([pixel]);

    storage.setRaw(storageKey, "{not json");
    expect(await store.loadTrustedDevices()).toEqual([]);
  });

  it("does not crash when storage is unavailable", async () => {
    const store = createTrustedDeviceStore(undefined);

    await expect(store.saveTrustedDevice(pixel)).resolves.toBeUndefined();
    expect(await store.loadTrustedDevices()).toEqual([]);
    await expect(store.removeTrustedDevice(pixel.deviceId)).resolves.toBeUndefined();
    await expect(store.clearTrustedDevices()).resolves.toBeUndefined();
  });
});
