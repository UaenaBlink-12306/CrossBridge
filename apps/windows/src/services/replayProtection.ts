import type { EncryptedEnvelopeInput } from "@crossbridge/protocol";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ReplayEntry {
  key: string;
  seenAt: number;
}

const DEFAULT_REPLAY_STORE_KEY = "crossbridge.seenEncryptedMessages.v1";
const DEFAULT_REPLAY_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_REPLAY_LIMIT = 512;

export class ReplayProtector {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly storage: StorageLike | undefined = getLocalStorage(),
    private readonly storageKey = DEFAULT_REPLAY_STORE_KEY,
    private readonly ttlMs = DEFAULT_REPLAY_TTL_MS,
    private readonly limit = DEFAULT_REPLAY_LIMIT,
    private readonly nowMs: () => number = Date.now
  ) {
    this.load();
  }

  accept(envelope: EncryptedEnvelopeInput): boolean {
    const now = this.nowMs();
    this.prune(now);
    const key = replayKey(envelope);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    this.prune(now);
    this.save();
    return true;
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const entries = JSON.parse(this.storage.getItem(this.storageKey) ?? "[]") as unknown;
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (isReplayEntry(entry)) {
          this.seen.set(entry.key, entry.seenAt);
        }
      }
      this.prune(this.nowMs());
    } catch {
      // Malformed replay cache should not prevent receiving fresh messages.
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify([...this.seen].map(([key, seenAt]) => ({
        key,
        seenAt
      }))));
    } catch {
      // Replay protection still works in-memory if persistent storage is blocked.
    }
  }

  private prune(now: number): void {
    for (const [key, seenAt] of this.seen) {
      if (now - seenAt > this.ttlMs) {
        this.seen.delete(key);
      }
    }

    const overflow = this.seen.size - this.limit;
    if (overflow <= 0) return;
    const oldest = [...this.seen.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(0, overflow);
    for (const [key] of oldest) {
      this.seen.delete(key);
    }
  }
}

function replayKey(envelope: EncryptedEnvelopeInput): string {
  return [
    envelope.fromDeviceId,
    envelope.toDeviceId,
    envelope.messageId,
    envelope.nonce,
    envelope.keyId ?? ""
  ].join("|");
}

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isReplayEntry(value: unknown): value is ReplayEntry {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ReplayEntry).key === "string" &&
    typeof (value as ReplayEntry).seenAt === "number" &&
    Number.isFinite((value as ReplayEntry).seenAt);
}
