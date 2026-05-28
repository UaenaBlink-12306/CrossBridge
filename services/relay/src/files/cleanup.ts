import type { EphemeralChunkStore } from "./chunkStore.js";

export function scheduleChunkCleanup(store: EphemeralChunkStore, intervalMs: number): () => void {
  const timer = setInterval(() => store.cleanup(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
