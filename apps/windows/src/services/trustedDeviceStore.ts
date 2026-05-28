import type { TrustedDevice } from "@crossbridge/protocol";
import { invokeTauriCommand, isTauriRuntime } from "./nativeBridge.js";

const TRUSTED_DEVICES_KEY = "crossbridge.trustedDevices.v1";
const TRUSTED_DEVICES_CHANGED_EVENT = "crossbridge:trusted-devices-changed";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TrustedDeviceStore {
  loadTrustedDevices(): Promise<TrustedDevice[]>;
  saveTrustedDevice(device: TrustedDevice): Promise<void>;
  removeTrustedDevice(deviceId: string): Promise<void>;
  clearTrustedDevices(): Promise<void>;
}

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function emitTrustedDevicesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TRUSTED_DEVICES_CHANGED_EVENT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isTrustedDevice(value: unknown): value is TrustedDevice {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.deviceId, 128)) return false;
  if (!isNonEmptyString(value.deviceName, 128)) return false;
  if (value.platform !== "windows" && value.platform !== "android") return false;
  if (!isNonEmptyString(value.publicKey)) return false;
  if (!isTimestamp(value.pairedAt)) return false;
  if (value.lastSeenAt !== undefined && !isTimestamp(value.lastSeenAt)) return false;
  return true;
}

function normalizeTrustedDevices(value: unknown): TrustedDevice[] {
  const entries = Array.isArray(value) ? value : [];
  const byDeviceId = new Map<string, TrustedDevice>();

  for (const entry of entries) {
    if (!isTrustedDevice(entry)) continue;
    byDeviceId.set(entry.deviceId, entry);
  }

  return [...byDeviceId.values()].sort((a, b) => b.pairedAt - a.pairedAt);
}

function parseTrustedDevices(raw: string | null): TrustedDevice[] {
  if (!raw) return [];

  try {
    return normalizeTrustedDevices(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function prepareTrustedDeviceForSave(
  device: TrustedDevice,
  devices: TrustedDevice[]
): TrustedDevice | undefined {
  if (!isTrustedDevice(device)) return undefined;
  const existing = devices.find((entry) => entry.deviceId === device.deviceId);
  return existing
    ? {
      ...existing,
      ...device,
      lastSeenAt: device.lastSeenAt ?? Date.now()
    }
    : device;
}

export function createTrustedDeviceStore(storage: StorageLike | undefined = getLocalStorage()): TrustedDeviceStore {
  async function write(devices: TrustedDevice[]): Promise<void> {
    if (!storage) return;
    try {
      storage.setItem(TRUSTED_DEVICES_KEY, JSON.stringify(devices));
      emitTrustedDevicesChanged();
    } catch {
      // localStorage can be unavailable in privacy modes or blocked webviews.
    }
  }

  return {
    async loadTrustedDevices(): Promise<TrustedDevice[]> {
      if (!storage) return [];
      try {
        return parseTrustedDevices(storage.getItem(TRUSTED_DEVICES_KEY));
      } catch {
        return [];
      }
    },

    async saveTrustedDevice(device: TrustedDevice): Promise<void> {
      const devices = await this.loadTrustedDevices();
      const savedDevice = prepareTrustedDeviceForSave(device, devices);
      if (!savedDevice) return;
      const nextDevices = [
        savedDevice,
        ...devices.filter((entry) => entry.deviceId !== device.deviceId)
      ].sort((a, b) => b.pairedAt - a.pairedAt);

      await write(nextDevices);
    },

    async removeTrustedDevice(deviceId: string): Promise<void> {
      const nextDevices = (await this.loadTrustedDevices())
        .filter((device) => device.deviceId !== deviceId);
      await write(nextDevices);
    },

    async clearTrustedDevices(): Promise<void> {
      if (!storage) return;
      try {
        storage.removeItem(TRUSTED_DEVICES_KEY);
        emitTrustedDevicesChanged();
      } catch {
        // localStorage can be unavailable in privacy modes or blocked webviews.
      }
    }
  };
}

const defaultStore = createTrustedDeviceStore();

export async function loadTrustedDevices(): Promise<TrustedDevice[]> {
  if (isTauriRuntime()) {
    return normalizeTrustedDevices(
      await invokeTauriCommand<unknown>("load_trusted_devices")
    );
  }

  return defaultStore.loadTrustedDevices();
}

export async function saveTrustedDevice(device: TrustedDevice): Promise<void> {
  if (!isTrustedDevice(device)) return;

  if (isTauriRuntime()) {
    await invokeTauriCommand<void>("save_trusted_device", { device });
    emitTrustedDevicesChanged();
    return;
  }

  await defaultStore.saveTrustedDevice(device);
}

export async function removeTrustedDevice(deviceId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauriCommand<void>("remove_trusted_device", { deviceId });
    emitTrustedDevicesChanged();
    return;
  }

  await defaultStore.removeTrustedDevice(deviceId);
}

export async function clearTrustedDevices(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauriCommand<void>("clear_trusted_devices");
    emitTrustedDevicesChanged();
    return;
  }

  await defaultStore.clearTrustedDevices();
}

export { TRUSTED_DEVICES_CHANGED_EVENT };
