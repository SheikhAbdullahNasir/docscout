import { describe, expect, it, vi } from 'vitest';
import {
  CompletedScanCache,
  DEFAULT_SCAN_CACHE_MAX_BYTES,
  DEFAULT_SCAN_CACHE_MAX_ENTRIES,
  DEFAULT_SCAN_CACHE_TTL_MS,
  ScanCoordinator,
} from './scanCache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type Result = {
  status: 'ready' | 'empty' | 'error';
  cached: boolean;
  evidence?: { text: string };
  scan?: { status: 'partial'; githubRequests: number };
};

describe('completed scan cache', () => {
  it('expires entries after the default TTL and removes them lazily', () => {
    let now = 1_000;
    const cache = new CompletedScanCache<Result>({ now: () => now });
    expect(DEFAULT_SCAN_CACHE_TTL_MS).toBe(10 * 60 * 1000);
    cache.set('repo', { status: 'ready', cached: false });

    now += DEFAULT_SCAN_CACHE_TTL_MS - 1;
    expect(cache.get('repo')?.status).toBe('ready');
    now += 1;
    expect(cache.get('repo')).toBeUndefined();
    expect(cache.entryCount).toBe(0);
    expect(cache.approximateBytes).toBe(0);
  });

  it('evicts the least recently used entry at the 51-entry cap', () => {
    const cache = new CompletedScanCache<Result>();
    expect(DEFAULT_SCAN_CACHE_MAX_ENTRIES).toBe(50);
    for (let index = 0; index < 50; index += 1) {
      cache.set(`repo-${index}`, { status: 'ready', cached: false });
    }

    expect(cache.get('repo-0')).toBeDefined();
    cache.set('repo-50', { status: 'ready', cached: false });

    expect(cache.entryCount).toBe(50);
    expect(cache.get('repo-0')).toBeDefined();
    expect(cache.get('repo-1')).toBeUndefined();
  });

  it('evicts least recently used results until within the byte cap and skips one oversized result', () => {
    const cache = new CompletedScanCache<{ text: string }>({ maxBytes: 28, maxEntries: 10 });
    cache.set('first', { text: 'aaaa' });
    cache.set('second', { text: 'bbbb' });
    cache.set('third', { text: 'ccccc' });

    expect(cache.approximateBytes).toBeLessThanOrEqual(28);
    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBeDefined();
    expect(DEFAULT_SCAN_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024);

    cache.set('oversized', { text: 'x'.repeat(100) });
    expect(cache.get('oversized')).toBeUndefined();
  });

  it('returns independent deep copies so response shaping cannot mutate cached evidence', () => {
    const cache = new CompletedScanCache<Result>();
    cache.set('repo', { status: 'ready', cached: false, evidence: { text: 'original' } });

    const response = cache.get('repo')!;
    response.cached = true;
    response.evidence!.text = 'mutated';

    expect(cache.get('repo')).toEqual({ status: 'ready', cached: false, evidence: { text: 'original' } });
  });
});

describe('in-flight scan coordinator', () => {
  const createCoordinator = () => new ScanCoordinator(new CompletedScanCache<Result>(),
    (result) => result.status === 'ready' || result.status === 'empty');

  it('shares one execution and gives each waiter an independent copy', async () => {
    const coordinator = createCoordinator();
    const task = deferred<Result>();
    const start = vi.fn(() => ({ promise: task.promise, cancel: vi.fn() }));
    const first = coordinator.run('owner/repo', new AbortController().signal, start);
    const second = coordinator.run('owner/repo', new AbortController().signal, start);
    task.resolve({ status: 'ready', cached: false, evidence: { text: 'same' } });

    const [left, right] = await Promise.all([first, second]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(left.result).toEqual(right.result);
    expect(left.result).not.toBe(right.result);
    expect(left.cached || right.cached).toBe(false);
  });

  it('runs different repository keys independently', async () => {
    const coordinator = createCoordinator();
    const firstTask = deferred<Result>();
    const secondTask = deferred<Result>();
    const firstStart = vi.fn(() => ({ promise: firstTask.promise, cancel: vi.fn() }));
    const secondStart = vi.fn(() => ({ promise: secondTask.promise, cancel: vi.fn() }));
    const first = coordinator.run('owner/one', new AbortController().signal, firstStart);
    const second = coordinator.run('owner/two', new AbortController().signal, secondStart);
    firstTask.resolve({ status: 'ready', cached: false, evidence: { text: 'one' } });
    secondTask.resolve({ status: 'ready', cached: false, evidence: { text: 'two' } });

    expect((await first).result.evidence?.text).toBe('one');
    expect((await second).result.evidence?.text).toBe('two');
    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
  });

  it('clears a failed shared scan so a later caller can retry', async () => {
    const coordinator = createCoordinator();
    const task = deferred<Result>();
    const firstStart = vi.fn(() => ({ promise: task.promise, cancel: vi.fn() }));
    const first = coordinator.run('owner/repo', new AbortController().signal, firstStart);
    const second = coordinator.run('owner/repo', new AbortController().signal, firstStart);
    const failure = new Error('upstream failed');
    task.reject(failure);

    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    const retryStart = vi.fn(() => ({
      promise: Promise.resolve({ status: 'ready' as const, cached: false }), cancel: vi.fn(),
    }));
    const retry = await coordinator.run('owner/repo', new AbortController().signal, retryStart);

    expect(retryStart).toHaveBeenCalledTimes(1);
    expect(retry.cached).toBe(false);
  });

  it('keeps a shared scan alive when one waiter disconnects', async () => {
    const coordinator = createCoordinator();
    const task = deferred<Result>();
    const cancel = vi.fn();
    const start = vi.fn(() => ({ promise: task.promise, cancel }));
    const disconnected = new AbortController();
    const remaining = new AbortController();
    const first = coordinator.run('owner/repo', disconnected.signal, start);
    const second = coordinator.run('owner/repo', remaining.signal, start);

    disconnected.abort(new Error('first caller disconnected'));
    await expect(first).rejects.toThrow('first caller disconnected');
    expect(cancel).not.toHaveBeenCalled();
    task.resolve({ status: 'ready', cached: false });
    expect((await second).result.status).toBe('ready');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('cancels underlying work when the final waiter disconnects', async () => {
    const coordinator = createCoordinator();
    const task = deferred<Result>();
    const cancel = vi.fn((reason: unknown) => task.reject(reason));
    const start = vi.fn(() => ({ promise: task.promise, cancel }));
    const disconnected = new AbortController();
    const pending = coordinator.run('owner/repo', disconnected.signal, start);
    const reason = new Error('last caller disconnected');

    disconnected.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(coordinator.inFlightCount).toBe(0);
  });

  it('serves a completed cache hit without starting another scan and keeps the cached copy stable', async () => {
    const coordinator = createCoordinator();
    const firstStart = vi.fn(() => ({
      promise: Promise.resolve({ status: 'ready' as const, cached: false, evidence: { text: 'original' } }), cancel: vi.fn(),
    }));
    const first = await coordinator.run('owner/repo', new AbortController().signal, firstStart);
    first.result.evidence!.text = 'browser changed its copy';
    first.result.cached = true;
    const shouldNotStart = vi.fn(() => ({ promise: Promise.resolve({ status: 'ready' as const, cached: false }), cancel: vi.fn() }));
    const hit = await coordinator.run('owner/repo', new AbortController().signal, shouldNotStart);

    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(shouldNotStart).not.toHaveBeenCalled();
    expect(hit.cached).toBe(true);
    expect(hit.result).toEqual({ status: 'ready', cached: false, evidence: { text: 'original' } });
  });

  it('caches useful partial results without changing their status or request evidence', async () => {
    const coordinator = createCoordinator();
    const partial = { status: 'ready' as const, cached: false, scan: { status: 'partial' as const, githubRequests: 7 } };
    const firstStart = vi.fn(() => ({ promise: Promise.resolve(partial), cancel: vi.fn() }));
    await coordinator.run('owner/repo', new AbortController().signal, firstStart);
    const shouldNotStart = vi.fn(() => ({ promise: Promise.resolve(partial), cancel: vi.fn() }));
    const cached = await coordinator.run('owner/repo', new AbortController().signal, shouldNotStart);

    expect(cached.cached).toBe(true);
    expect(cached.result.scan).toEqual({ status: 'partial', githubRequests: 7 });
    expect(shouldNotStart).not.toHaveBeenCalled();
  });

  it('returns a successful result larger than the byte cap without retaining it', async () => {
    const coordinator = new ScanCoordinator(new CompletedScanCache<Result>({ maxBytes: 8 }),
      (result) => result.status === 'ready' || result.status === 'empty');
    const large = { status: 'ready' as const, cached: false, evidence: { text: 'too large' } };
    const firstStart = vi.fn(() => ({ promise: Promise.resolve(large), cancel: vi.fn() }));
    const returned = await coordinator.run('owner/repo', new AbortController().signal, firstStart);
    const secondStart = vi.fn(() => ({ promise: Promise.resolve(large), cancel: vi.fn() }));
    const second = await coordinator.run('owner/repo', new AbortController().signal, secondStart);

    expect(returned.result).toEqual(large);
    expect(returned.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
  });
});
