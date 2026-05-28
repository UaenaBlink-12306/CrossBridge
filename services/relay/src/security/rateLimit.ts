export interface RateLimitOptions {
  windowMs: number;
  maxEvents: number;
}

interface Bucket {
  startedAt: number;
  count: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: RateLimitOptions) {}

  isAllowed(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key);

    if (!existing || now - existing.startedAt > this.options.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }

    existing.count += 1;
    return existing.count <= this.options.maxEvents;
  }

  cleanup(now = Date.now()): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.startedAt > this.options.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
