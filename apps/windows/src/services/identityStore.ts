import {
  generateDevelopmentKeyPair,
  isValidDevelopmentKeyPair,
  type DevelopmentKeyPair
} from "@crossbridge/crypto";
import type { DeviceIdentity } from "@crossbridge/protocol";
import { invokeTauriCommand, isTauriRuntime } from "./nativeBridge.js";

const BROWSER_WINDOWS_IDENTITY_KEY = "crossbridge.windowsIdentity.v3";
const PREVIOUS_WINDOWS_IDENTITY_KEY = "crossbridge.windowsIdentity.v2";
const LEGACY_WINDOWS_IDENTITY_KEY = "crossbridge.windowsIdentity.v1";
const DEFAULT_WINDOWS_DEVICE_NAME = "CrossBridge Windows";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WindowsCryptoIdentity {
  identity: DeviceIdentity;
  privateKey: string;
}

type NativeWindowsCryptoIdentity = WindowsCryptoIdentity | null;

let memoryOnlyCryptoIdentity: WindowsCryptoIdentity | undefined;

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function randomToken(prefix: string, byteLength = 18): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto?.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}_${btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isDeviceIdentity(value: unknown): value is DeviceIdentity {
  return isRecord(value) &&
    isNonEmptyString(value.deviceId, 128) &&
    isNonEmptyString(value.deviceName, 128) &&
    value.platform === "windows" &&
    isNonEmptyString(value.publicKey);
}

function normalizeStoredIdentity(value: unknown, keyPair?: DevelopmentKeyPair): DeviceIdentity | undefined {
  const candidate = isRecord(value) && isRecord(value.identity) ? value.identity : value;
  if (isDeviceIdentity(candidate)) return candidate;
  if (!isRecord(candidate)) return undefined;

  const deviceId = isNonEmptyString(candidate.deviceId, 128)
    ? candidate.deviceId
    : randomToken("pc", 12);
  const deviceName = isNonEmptyString(candidate.deviceName, 128)
    ? candidate.deviceName
    : DEFAULT_WINDOWS_DEVICE_NAME;
  const publicKey = keyPair?.publicKey ?? (isNonEmptyString(candidate.publicKey)
    ? candidate.publicKey
    : undefined);
  if (!publicKey) return undefined;

  return {
    deviceId,
    deviceName,
    platform: "windows",
    publicKey
  };
}

async function normalizeStoredCryptoIdentity(value: unknown): Promise<WindowsCryptoIdentity | undefined> {
  if (!isRecord(value)) return undefined;
  const identity = normalizeStoredIdentity(value);
  const privateKey = isNonEmptyString(value.privateKey) ? value.privateKey : undefined;
  if (!identity || !privateKey) return undefined;
  if (await isValidDevelopmentKeyPair({ publicKey: identity.publicKey, privateKey })) {
    return { identity, privateKey };
  }
  return undefined;
}

async function loadStoredBrowserCryptoIdentity(storage: StorageLike): Promise<WindowsCryptoIdentity | undefined> {
  try {
    const parsed = JSON.parse(storage.getItem(BROWSER_WINDOWS_IDENTITY_KEY) ?? "null") as unknown;
    const stored = await normalizeStoredCryptoIdentity(parsed);
    if (stored) return stored;
  } catch {
    // Ignore malformed development storage and create a fresh dev key pair.
  }

  for (const key of [PREVIOUS_WINDOWS_IDENTITY_KEY, LEGACY_WINDOWS_IDENTITY_KEY]) {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "null") as unknown;
      const identity = normalizeStoredIdentity(parsed);
      if (identity) return createBrowserDevelopmentCryptoIdentity(identity);
    } catch {
      // Ignore malformed development storage and create a fresh dev identity.
    }
  }
  return undefined;
}

function storeBrowserCryptoIdentity(storage: StorageLike | undefined, cryptoIdentity: WindowsCryptoIdentity): void {
  if (!storage) return;
  try {
    // Development fallback only. The private key is real ECDH key material,
    // but it is not OS-protected in browser/dev mode.
    storage.setItem(BROWSER_WINDOWS_IDENTITY_KEY, JSON.stringify(cryptoIdentity));
  } catch {
    // localStorage can be unavailable in privacy modes or blocked webviews.
  }
}

function removeBrowserCryptoIdentity(storage: StorageLike | undefined): void {
  if (!storage) return;
  for (const key of [BROWSER_WINDOWS_IDENTITY_KEY, PREVIOUS_WINDOWS_IDENTITY_KEY, LEGACY_WINDOWS_IDENTITY_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      // localStorage can be unavailable in privacy modes or blocked webviews.
    }
  }
}

async function createBrowserDevelopmentCryptoIdentity(
  existingIdentity?: Pick<DeviceIdentity, "deviceId" | "deviceName" | "platform">
): Promise<WindowsCryptoIdentity> {
  const keyPair = await generateDevelopmentKeyPair();
  return {
    identity: {
      deviceId: existingIdentity?.deviceId ?? randomToken("pc", 12),
      deviceName: existingIdentity?.deviceName ?? DEFAULT_WINDOWS_DEVICE_NAME,
      platform: "windows",
      publicKey: keyPair.publicKey
    },
    privateKey: keyPair.privateKey
  };
}

async function loadOrCreateBrowserCryptoIdentity(): Promise<WindowsCryptoIdentity> {
  const storage = getLocalStorage();
  if (storage) {
    const stored = await loadStoredBrowserCryptoIdentity(storage);
    if (stored) {
      memoryOnlyCryptoIdentity = stored;
      storeBrowserCryptoIdentity(storage, stored);
      return stored;
    }
  }

  if (memoryOnlyCryptoIdentity) return memoryOnlyCryptoIdentity;

  const created = await createBrowserDevelopmentCryptoIdentity();
  memoryOnlyCryptoIdentity = created;
  storeBrowserCryptoIdentity(storage, created);
  return created;
}

export async function loadOrCreateWindowsIdentity(): Promise<DeviceIdentity> {
  return (await loadOrCreateWindowsCryptoIdentity()).identity;
}

export async function loadOrCreateWindowsCryptoIdentity(): Promise<WindowsCryptoIdentity> {
  if (isTauriRuntime()) {
    const storage = getLocalStorage();
    const nativeIdentity = await invokeTauriCommand<DeviceIdentity>("get_or_create_windows_identity");
    const nativeCryptoIdentity = await invokeTauriCommand<NativeWindowsCryptoIdentity>("load_windows_crypto_identity");
    if (
      nativeCryptoIdentity &&
      isDeviceIdentity(nativeCryptoIdentity.identity) &&
      await isValidDevelopmentKeyPair({
        publicKey: nativeCryptoIdentity.identity.publicKey,
        privateKey: nativeCryptoIdentity.privateKey
      })
    ) {
      memoryOnlyCryptoIdentity = nativeCryptoIdentity;
      removeBrowserCryptoIdentity(storage);
      return nativeCryptoIdentity;
    }

    const migrated = storage ? await loadStoredBrowserCryptoIdentity(storage) : undefined;
    const cryptoIdentity = migrated ?? await createBrowserDevelopmentCryptoIdentity(nativeIdentity);
    const identity = {
      ...cryptoIdentity.identity,
      deviceId: nativeIdentity.deviceId,
      deviceName: nativeIdentity.deviceName,
      platform: "windows" as const
    };
    if (!isDeviceIdentity(identity)) {
      throw new Error("Native Windows identity storage returned an invalid identity.");
    }

    const protectedIdentity = { identity, privateKey: cryptoIdentity.privateKey };
    await invokeTauriCommand<void>("save_windows_crypto_identity", protectedIdentity);
    memoryOnlyCryptoIdentity = protectedIdentity;
    removeBrowserCryptoIdentity(storage);
    return protectedIdentity;
  }

  return loadOrCreateBrowserCryptoIdentity();
}

export async function resetWindowsIdentityForDevOnly(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauriCommand<void>("reset_windows_identity_for_dev_only");
  }

  memoryOnlyCryptoIdentity = undefined;
  const storage = getLocalStorage();
  removeBrowserCryptoIdentity(storage);
}
