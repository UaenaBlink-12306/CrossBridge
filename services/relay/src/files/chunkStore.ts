export interface StoredChunk {
  transferId: string;
  chunkIndex: number;
  ciphertext: Uint8Array;
  expiresAt: number;
}

export class EphemeralChunkStore {
  private readonly chunks = new Map<string, StoredChunk>();

  set(chunk: StoredChunk): void {
    this.chunks.set(this.key(chunk.transferId, chunk.chunkIndex), chunk);
  }

  get(transferId: string, chunkIndex: number, now = Date.now()): StoredChunk | undefined {
    const chunk = this.chunks.get(this.key(transferId, chunkIndex));
    if (!chunk) return undefined;
    if (chunk.expiresAt <= now) {
      this.delete(transferId, chunkIndex);
      return undefined;
    }
    return chunk;
  }

  delete(transferId: string, chunkIndex: number): void {
    this.chunks.delete(this.key(transferId, chunkIndex));
  }

  cleanup(now = Date.now()): void {
    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.expiresAt <= now) {
        this.chunks.delete(key);
      }
    }
  }

  private key(transferId: string, chunkIndex: number): string {
    return `${transferId}:${chunkIndex}`;
  }
}
