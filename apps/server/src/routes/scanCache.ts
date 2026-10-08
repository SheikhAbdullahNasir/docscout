import { ApplicationError } from '../errors.js';

export const DEFAULT_SCAN_CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_SCAN_CACHE_MAX_ENTRIES = 50;
export const DEFAULT_SCAN_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_UNIQUE_SCANS = 10;
const PENDING_SCAN_RETRY_GUIDANCE_MS = 5_000;

type CacheEntry = { serialized: string; insertedAt: number; bytes: number };

export class CompletedScanCache<T> {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: {
    now?: () => number;
    ttlMs?: number;
    maxEntries?: number;
    maxBytes?: number;
  } = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_SCAN_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_SCAN_CACHE_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_SCAN_CACHE_MAX_BYTES;
  }

  get entryCount() { return this.entries.size; }
  get approximateBytes() { return this.bytes; }

  get(key: string): T | undefined {
    this.removeExpired(this.now());
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return JSON.parse(entry.serialized) as T;
  }

  set(key: string, value: T) {
    const now = this.now();
    this.removeExpired(now);
    this.remove(key);
    if (this.maxEntries < 1 || this.maxBytes < 1) return;

    let serialized: string;
    try {
      const result = JSON.stringify(value);
      if (result === undefined) return;
      serialized = result;
    } catch {
      // Results that are not JSON-safe are returned to the current caller but not cached.
      return;
    }
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > this.maxBytes) return;

    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
    this.entries.set(key, { serialized, insertedAt: now, bytes });
    this.bytes += bytes;
  }

  private removeExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.insertedAt >= this.ttlMs) this.remove(key);
    }
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }
}

export type ScanTask<T> = {
  promise: Promise<T>;
  cancel: (reason: unknown) => void;
};

type InFlightEntry<T> = {
  promise: Promise<T>;
  callers: Set<object>;
  cancel: (reason: unknown) => void;
  settled: boolean;
  cancelled: boolean;
};

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Shares one scan among current callers and caches only successful useful results. */
export class ScanCoordinator<T> {
  private readonly inFlight = new Map<string, InFlightEntry<T>>();
  private readonly now: () => number;
  private readonly maxPending: number;

  constructor(
    private readonly cache: CompletedScanCache<T>,
    private readonly isCacheable: (result: T) => boolean,
    options: { now?: () => number; maxPending?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING_UNIQUE_SCANS;
  }

  get inFlightCount() { return this.inFlight.size; }

  run(key: string, callerSignal: AbortSignal, start: () => ScanTask<T>): Promise<{ result: T; cached: boolean }> {
    if (callerSignal.aborted) return Promise.reject(callerSignal.reason);

    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve({ result: cached, cached: true });

    let entry = this.inFlight.get(key);
    if (!entry) {
      if (this.inFlight.size >= this.maxPending) {
        const retryAt = new Date(this.now() + PENDING_SCAN_RETRY_GUIDANCE_MS).toISOString();
        return Promise.reject(new ApplicationError(429, 'SCAN_CAPACITY_EXCEEDED',
          'DocScout is busy with other scans. Please retry shortly.', retryAt));
      }

      let task: ScanTask<T>;
      try { task = start(); }
      catch (error) { return Promise.reject(error); }

      entry = {
        promise: task.promise,
        callers: new Set(),
        cancel: task.cancel,
        settled: false,
        cancelled: false,
      };
      const ownedEntry = entry;
      this.inFlight.set(key, ownedEntry);
      entry.promise = Promise.resolve(task.promise).then((result) => {
        if (!ownedEntry.cancelled && this.isCacheable(result)) this.cache.set(key, result);
        return result;
      }).finally(() => {
          ownedEntry.settled = true;
          if (this.inFlight.get(key) === ownedEntry) this.inFlight.delete(key);
      });
    }

    return this.waitForResult(key, entry, callerSignal);
  }

  private waitForResult(key: string, entry: InFlightEntry<T>, signal: AbortSignal): Promise<{ result: T; cached: boolean }> {
    const caller = {};
    entry.callers.add(caller);

    return new Promise((resolve, reject) => {
      let finished = false;
      const detach = (reason?: unknown) => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        entry.callers.delete(caller);
        if (!entry.settled && entry.callers.size === 0 && !entry.cancelled) {
          entry.cancelled = true;
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
          try { entry.cancel(reason); } catch { /* Cancellation must not strand the other coordinator state. */ }
        }
        return true;
      };
      const onAbort = () => {
        const reason = signal.reason;
        if (detach(reason)) reject(reason);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      entry.promise.then(
        (result) => {
          if (detach()) resolve({ result: copyJson(result), cached: false });
        },
        (error: unknown) => {
          if (detach()) reject(error);
        },
      );
    });
  }
}
