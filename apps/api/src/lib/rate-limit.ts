export type RateLimitBucket = "signup" | "join_request" | "message" | "guide";

export type RateLimits = Record<RateLimitBucket, number>;

export const defaultRateLimits: RateLimits = {
  signup: 50,
  join_request: 20,
  message: 200,
  guide: 50,
};

export class RateLimiter {
  private hits = new Map<string, number>();

  constructor(private limits: RateLimits = defaultRateLimits) {}

  consume(bucket: RateLimitBucket, key: string): boolean {
    const limit = this.limits[bucket];
    if (!Number.isFinite(limit) || limit <= 0) return true;
    const day = new Date().toISOString().slice(0, 10);
    const k = `${bucket}:${key}:${day}`;
    const n = (this.hits.get(k) ?? 0) + 1;
    this.hits.set(k, n);
    return n <= limit;
  }

  reset(): void {
    this.hits.clear();
  }
}
