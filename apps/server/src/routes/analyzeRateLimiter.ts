export const MAX_ANALYZE_REQUESTS_PER_WINDOW = 5;
export const ANALYZE_RATE_WINDOW_MS = 10 * 60 * 1000;

export type AnalyzeAdmission = { allowed: true } | { allowed: false; retryAt: number };

/** Small, deterministic rolling-window limiter for one server process. */
export class AnalyzeRateLimiter {
  private readonly requestsByIp = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  admit(clientIp: string): AnalyzeAdmission {
    const now = this.now();

    // Remove stale timestamps and empty IP buckets on every request, so old clients
    // never permanently retain memory or continue consuming admission capacity.
    for (const [ip, timestamps] of this.requestsByIp) {
      const active = timestamps.filter((timestamp) => now - timestamp < ANALYZE_RATE_WINDOW_MS);
      if (active.length === 0) this.requestsByIp.delete(ip);
      else if (active.length !== timestamps.length) this.requestsByIp.set(ip, active);
    }

    const timestamps = this.requestsByIp.get(clientIp) ?? [];
    if (timestamps.length >= MAX_ANALYZE_REQUESTS_PER_WINDOW) {
      return { allowed: false, retryAt: timestamps[0] + ANALYZE_RATE_WINDOW_MS };
    }

    timestamps.push(now);
    this.requestsByIp.set(clientIp, timestamps);
    return { allowed: true };
  }
}
