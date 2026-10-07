import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicRepositoryMetadata } from '@docscout/shared';
import { GitHubClient } from './client.js';
import { ScanBudget } from './scanBudget.js';
import { parseRepositoryUrl } from '../security/repositoryUrl.js';

const input = parseRepositoryUrl('https://github.com/Canonical/Repo');
const repository: PublicRepositoryMetadata = {
  owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
  private: false, archived: false, defaultBranch: 'main',
};
const metadata = { ...repository, owner: { login: repository.owner }, html_url: repository.url, default_branch: 'main' };
const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);
const commit = { sha: commitSha, commit: { tree: { sha: treeSha } } };
const tree = { sha: treeSha, tree: [], truncated: false };

function issue(number: number) {
  return { number, title: `Issue ${number}`, html_url: `${repository.url}/issues/${number}`,
    state: 'open', labels: [{ name: 'good first issue' }], updated_at: '2026-10-03T12:00:00Z',
    assignees: [], body: 'Useful issue evidence' };
}

function pendingFetch(signals: AbortSignal[]): typeof fetch {
  return async (_url, options) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal as AbortSignal;
    signals.push(signal);
    signal.addEventListener('abort', () => reject(new Error('private transport details')), { once: true });
  });
}

afterEach(() => vi.useRealTimers());

describe('shared scan request budget', () => {
  it('counts metadata, snapshot, documents, and issue pagination in one normal scan', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json({ ...tree, tree: [
        { path: 'README.md', type: 'blob', mode: '100644', sha: blobSha, size: 4 },
      ] }))
      .mockResolvedValueOnce(Response.json({ type: 'file', encoding: 'base64', path: 'README.md', sha: blobSha, size: 4, content: 'dGV4dA==' }))
      .mockResolvedValueOnce(Response.json([issue(1)], { headers: {
        Link: '<https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=2>; rel="next"',
      } }))
      .mockResolvedValueOnce(Response.json([issue(2)])).mockResolvedValueOnce(Response.json([]));
    const client = new GitHubClient({ fetcher });
    const budget = new ScanBudget();
    try {
      const publicRepo = await client.getRepository(input, budget);
      const result = await client.getSnapshot(publicRepo, budget);
      expect(result.issues.items.map(({ number }) => number)).toEqual([1, 2]);
      expect(result.issues.coverage.complete).toBe(true);
      expect(budget.requestsUsed).toBe(7);
      expect(budget.remainingRequests).toBe(23);
      expect(result.scan).toBeUndefined();
    } finally { budget.dispose(); }
  });

  it('allows request 30 and prevents request 31 at the transport boundary', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(metadata));
    const client = new GitHubClient({ fetcher });
    const budget = new ScanBudget();
    try {
      for (let index = 0; index < 30; index++) await client.getRepository(input, budget);
      expect(budget.requestsUsed).toBe(30);
      expect(budget.remainingRequests).toBe(0);
      await expect(client.getRepository(input, budget)).rejects.toMatchObject({ code: 'GITHUB_REQUEST_BUDGET_EXHAUSTED' });
      expect(fetcher).toHaveBeenCalledTimes(30);
    } finally { budget.dispose(); }
  });

  it('counts failed and retry-like attempts without adding automatic retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json(metadata));
    const client = new GitHubClient({ fetcher });
    const budget = new ScanBudget();
    try {
      await expect(client.getRepository(input, budget)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
      expect(budget.requestsUsed).toBe(1);
      await expect(client.getRepository(input, budget)).resolves.toMatchObject({ name: 'Repo' });
      expect(budget.requestsUsed).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { budget.dispose(); }
  });

  it('retains a completed issue page when pagination exhausts the shared budget', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json(tree))
      .mockResolvedValueOnce(Response.json([issue(7)], { headers: {
        Link: '<https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=2>; rel="next"',
      } }));
    const budget = new ScanBudget();
    for (let index = 0; index < 27; index++) budget.consumeRequest();
    try {
      const result = await new GitHubClient({ fetcher }).getSnapshot(repository, budget);
      expect(result).toMatchObject({ scan: { status: 'partial', githubRequests: 30, warnings: [
        { code: 'GITHUB_REQUEST_BUDGET_EXHAUSTED', message: expect.any(String) },
      ] }, issues: { items: [{ number: 7 }], coverage: { complete: false, queries: [
        { status: 'partial', pagesFetched: 1, reason: 'GITHUB_REQUEST_BUDGET_EXHAUSTED' },
        { status: 'failed', pagesFetched: 0, reason: 'GITHUB_REQUEST_BUDGET_EXHAUSTED' },
      ] } } });
      expect(result.status === 'ready' && result.snapshot.analysis.findings[0]).toMatchObject({ type: 'labeled-issue' });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { budget.dispose(); }
  });

  it('retains completed documents and marks remaining selected content unknown after exhaustion', async () => {
    const text = '[Missing](missing.md)';
    const entries = ['README.md', 'docs/a.md'].map((path) => ({ path, type: 'blob', mode: '100644', sha: blobSha, size: text.length }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json({ ...tree, tree: entries }))
      .mockResolvedValueOnce(Response.json({ type: 'file', encoding: 'base64', path: 'README.md', sha: blobSha,
        size: text.length, content: Buffer.from(text).toString('base64') }));
    const budget = new ScanBudget();
    for (let index = 0; index < 27; index++) budget.consumeRequest();
    try {
      const result = await new GitHubClient({ fetcher }).getSnapshot(repository, budget);
      expect(result).toMatchObject({ scan: { status: 'partial' }, snapshot: { documents: {
        readme: { status: 'available', document: { text } },
        skipped: [{ path: 'docs/a.md', reason: 'GITHUB_REQUEST_BUDGET_EXHAUSTED' }],
        omissions: ['GITHUB_REQUEST_BUDGET_EXHAUSTED'],
      }, analysis: { findings: [{ type: 'missing-local-target' }] } }, issues: { coverage: { complete: false } } });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { budget.dispose(); }
  });
});

describe('request and scan deadlines', () => {
  it('aborts a request at 10 seconds and returns a safe typed timeout', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const operation = new GitHubClient({ fetcher: pendingFetch(signals), token: 'token-sentinel' }).getRepository(input);
    const assertion = expect(operation).rejects.toMatchObject({ status: 504, code: 'GITHUB_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signals[0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels stalled response-body reading within the same 10-second request timeout', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"private":false')); },
      cancel() { cancelled = true; },
    });
    const operation = new GitHubClient({ fetcher: async () => new Response(stream) }).getRepository(input);
    const assertion = expect(operation).rejects.toMatchObject({ code: 'GITHUB_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the remaining scan time for a request and prevents any work after 60 seconds', async () => {
    vi.useFakeTimers();
    const budget = new ScanBudget();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(pendingFetch(signals));
    const client = new GitHubClient({ fetcher });
    try {
      expect(budget.deadline).toBe(Date.now() + 60_000);
      await vi.advanceTimersByTimeAsync(55_000);
      expect(budget.remainingTimeMs).toBe(5_000);
      const assertion = expect(client.getRepository(input, budget)).rejects.toMatchObject({ status: 504, code: 'SCAN_DEADLINE_EXCEEDED' });
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(signals[0].aborted).toBe(true);
      await expect(client.getRepository(input, budget)).rejects.toMatchObject({ code: 'SCAN_DEADLINE_EXCEEDED' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { budget.dispose(); }
  });

  it('checks injectable absolute timing before dispatch even when timer callbacks have not run', async () => {
    let time = 100;
    const budget = new ScanBudget({ now: () => time });
    const fetcher = vi.fn<typeof fetch>();
    try {
      time = 60_100;
      await expect(new GitHubClient({ fetcher }).getRepository(input, budget)).rejects.toMatchObject({ code: 'SCAN_DEADLINE_EXCEEDED' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(budget.requestsUsed).toBe(0);
    } finally { budget.dispose(); }
  });

  it('rejects a response after 10 seconds of injected time even before timer callbacks run', async () => {
    let time = 0;
    const budget = new ScanBudget({ now: () => time });
    let signal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (_url, options) => {
      signal = options?.signal as AbortSignal;
      time = 10_000;
      return Response.json(metadata);
    };
    try {
      await expect(new GitHubClient({ fetcher }).getRepository(input, budget)).rejects.toMatchObject({ status: 504, code: 'GITHUB_REQUEST_TIMEOUT' });
      expect(signal?.aborted).toBe(true);
      expect(budget.requestsUsed).toBe(1);
    } finally { budget.dispose(); }
  });

  it('returns completed documents as partial when the scan deadline aborts a later file', async () => {
    vi.useFakeTimers();
    const paths = ['README.md', ...Array.from({ length: 5 }, (_, index) => `docs/${index}.md`)];
    const entries = paths.map((path) => ({ path, type: 'blob', mode: '100644', sha: blobSha, size: 4 }));
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      const signal = options?.signal as AbortSignal;
      signals.push(signal);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 9_000);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('private details')); }, { once: true });
      });
      const target = String(url);
      if (target.endsWith('/repos/Canonical/Repo')) return Response.json(metadata);
      if (target.includes('/commits/')) return Response.json(commit);
      if (target.includes('/git/trees/')) return Response.json({ ...tree, tree: entries });
      const path = target.includes('/README.md?') ? 'README.md' : /\/contents\/(docs\/\d.md)\?/.exec(target)?.[1];
      return Response.json({ type: 'file', encoding: 'base64', path, sha: blobSha, size: 4, content: 'dGV4dA==' });
    });
    const budget = new ScanBudget();
    try {
      const client = new GitHubClient({ fetcher });
      const operation = (async () => client.getSnapshot(await client.getRepository(input, budget), budget))();
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await operation;
      expect(result).toMatchObject({ scan: { status: 'partial', githubRequests: 7, warnings: [
        { code: 'SCAN_DEADLINE_EXCEEDED' },
      ] }, snapshot: { documents: { readme: { status: 'available' }, docs: [
        { path: 'docs/0.md', text: 'text' }, { path: 'docs/1.md', text: 'text' },
      ], omissions: ['SCAN_DEADLINE_EXCEEDED'] }, analysis: {
        markdownLinks: { coverage: { documentsAnalyzed: 0, documentsUnchecked: 3,
          uncheckedDocumentsByReason: { scanDeadline: 3 } } },
        npmScripts: { coverage: { status: 'skipped', skipReason: 'scan-deadline' } },
      } }, issues: { coverage: { complete: false } } });
      expect(signals.at(-1)?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(7);
    } finally { budget.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('streamed GitHub response caps', () => {
  it.each(['metadata', 'tree'] as const)('accepts %s below its byte cap', async (stage) => {
    const limit = stage === 'tree' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
    const response = Response.json({ ...(stage === 'tree' ? tree : metadata), padding: 'x'.repeat(limit - 500) });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(stage === 'tree' ? Response.json(commit) : response);
    if (stage === 'tree') fetcher.mockResolvedValueOnce(response).mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const client = new GitHubClient({ fetcher });
    if (stage === 'tree') await expect(client.getSnapshot(repository)).resolves.toMatchObject({ status: 'ready' });
    else await expect(client.getRepository(input)).resolves.toMatchObject({ name: 'Repo' });
  });

  it.each(['metadata', 'tree'] as const)('cancels oversized %s while reading and never reads the trailing chunk', async (stage) => {
    const limit = stage === 'tree' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
    let pulls = 0;
    let cancelled = false;
    let signal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(pulls === 1 ? limit : 1)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).includes('/commits/')) return Response.json(commit);
      signal = options?.signal as AbortSignal;
      return new Response(stream);
    });
    const client = new GitHubClient({ fetcher, token: 'token-sentinel' });
    const operation = stage === 'tree' ? client.getSnapshot(repository) : client.getRepository(input);
    await expect(operation).rejects.toMatchObject({ code: 'GITHUB_RESPONSE_TOO_LARGE', status: 502 });
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
    expect(signal?.aborted).toBe(true);
  });
});
