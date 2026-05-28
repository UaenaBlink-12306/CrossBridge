import { afterEach, describe, expect, it, vi } from "vitest";

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
}

const browserIdentityKey = "crossbridge.windowsIdentity.v3";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("identityStore browser fallback", () => {
  it("creates a stable Windows identity with development private key material kept local", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { loadOrCreateWindowsIdentity } = await import("./identityStore.js");

    const firstIdentity = await loadOrCreateWindowsIdentity();
    const secondIdentity = await loadOrCreateWindowsIdentity();

    expect(secondIdentity).toEqual(firstIdentity);
    expect(firstIdentity.deviceId).toMatch(/^pc_/);
    expect(firstIdentity.deviceName).toBe("CrossBridge Windows");
    expect(firstIdentity.platform).toBe("windows");
    expect(firstIdentity.publicKey.length).toBeGreaterThan(0);

    const stored = JSON.parse(storage.getItem(browserIdentityKey) ?? "{}") as Record<string, unknown>;
    expect(stored.identity).toEqual(firstIdentity);
    expect(typeof stored.privateKey).toBe("string");
  });

  it("returns the same identity after module reload", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);

    const firstModule = await import("./identityStore.js");
    const firstIdentity = await firstModule.loadOrCreateWindowsIdentity();

    vi.resetModules();

    const secondModule = await import("./identityStore.js");
    const secondIdentity = await secondModule.loadOrCreateWindowsIdentity();

    expect(secondIdentity).toEqual(firstIdentity);
  });
});
