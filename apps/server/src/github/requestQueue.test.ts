import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../errors.js';
import { GitHubClient } from './client.js';
import { ScanBudget } from './scanBudget.js';
import { parseRepositoryUrl } from '../security/repositoryUrl.js';

const input = parseRepositoryUrl('https://github.com/owner/repo');
const metadata = {
  owner: { login: 'CanonicalOwner' }, name: 'CanonicalRepo',
  html_url: 'https://github.com/CanonicalOwner/CanonicalRepo',
  private: false, archived: false, default_branch: 'main',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('process-wide GitHub request queue', () => {
  it('runs simultaneous requests one at a time in FIFO order', async () => {
    const firstGate = deferred();
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetcher = (name: string, blocked = false): typeof fetch => vi.fn(async () => {
      order.push(name);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (blocked) await firstGate.promise;
      active -= 1;
      return Response.json(metadata);
    });
    const firstFetch = fetcher('first', true);
    const secondFetch = fetcher('second');
    const thirdFetch = fetcher('third');
    const first = new GitHubClient({ fetcher: firstFetch }).getRepository(input);
    try {
      await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));
      const second = new GitHubClient({ fetcher: secondFetch }).getRepository(input);
      const third = new GitHubClient({ fetcher: thirdFetch }).getRepository(input);
      await Promise.resolve();
      expect(secondFetch).not.toHaveBeenCalled();
      expect(thirdFetch).not.toHaveBeenCalled();
      firstGate.resolve();
      await Promise.all([first, second, third]);
      expect(order).toEqual(['first', 'second', 'third']);
      expect(maximumActive).toBe(1);
    } finally {
      firstGate.resolve();
      await first.catch(() => undefined);
    }
  });

  it('releases its slot after both successful and failed requests', async () => {
    const successfulFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
    const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 400 }));
    const afterFailureFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));

    await expect(new GitHubClient({ fetcher: successfulFetch }).getRepository(input)).resolves.toMatchObject({ name: 'CanonicalRepo' });
    await expect(new GitHubClient({ fetcher: failedFetch }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
    await expect(new GitHubClient({ fetcher: afterFailureFetch }).getRepository(input)).resolves.toMatchObject({ name: 'CanonicalRepo' });

    expect(successfulFetch).toHaveBeenCalledTimes(1);
    expect(failedFetch).toHaveBeenCalledTimes(1);
    expect(afterFailureFetch).toHaveBeenCalledTimes(1);
  });

  it('skips a queued request when its scan deadline expires before dispatch', async () => {
    const firstGate = deferred();
    const firstFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      await firstGate.promise;
      return Response.json(metadata);
    });
    const queuedFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
    const first = new GitHubClient({ fetcher: firstFetch }).getRepository(input);
    let now = Date.now();
    const budget = new ScanBudget({ now: () => now });
    const queued = new GitHubClient({ fetcher: queuedFetch }).getRepository(input, budget);
    try {
      await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));
      now = budget.deadline + 1;
      expect(() => budget.checkDeadline()).toThrowError();
      await expect(queued).rejects.toMatchObject({ code: 'SCAN_DEADLINE_EXCEEDED' });
      expect(queuedFetch).not.toHaveBeenCalled();
    } finally {
      firstGate.resolve();
      budget.dispose();
      await first.catch(() => undefined);
    }
  });

  it('removes a cancelled queued scan without blocking later requests', async () => {
    const firstGate = deferred();
    const firstFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      await firstGate.promise;
      return Response.json(metadata);
    });
    const cancelledFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
    const laterFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
    const first = new GitHubClient({ fetcher: firstFetch }).getRepository(input);
    const budget = new ScanBudget();
    const cancelled = new GitHubClient({ fetcher: cancelledFetch }).getRepository(input, budget);
    const later = new GitHubClient({ fetcher: laterFetch }).getRepository(input);
    try {
      await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));
      budget.cancel(new ApplicationError(504, 'SCAN_DEADLINE_EXCEEDED', 'The test scan was cancelled.'));
      await expect(cancelled).rejects.toMatchObject({ code: 'SCAN_DEADLINE_EXCEEDED' });
      firstGate.resolve();
      await Promise.all([first, later]);
      expect(cancelledFetch).not.toHaveBeenCalled();
      expect(laterFetch).toHaveBeenCalledTimes(1);
    } finally {
      firstGate.resolve();
      budget.dispose();
      await Promise.all([first.catch(() => undefined), later.catch(() => undefined)]);
    }
  });
});
