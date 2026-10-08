import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client.js';
import { ScanBudget } from './scanBudget.js';
import { parseRepositoryUrl, type ValidatedRepository } from '../security/repositoryUrl.js';

const metadata = {
  owner: { login: 'CanonicalOwner' }, name: 'CanonicalRepo',
  html_url: 'https://github.com/CanonicalOwner/CanonicalRepo',
  private: false, archived: true, default_branch: 'release/docs',
  ignored_field: 'not returned',
};
const input = parseRepositoryUrl('https://github.com/owner/repo');

function fakeTime(start = 1_800_000_000_000) {
  let current = start;
  return {
    clock: () => current,
    now: () => new Date(current),
    sleep: vi.fn(async (milliseconds: number, signal: AbortSignal) => {
      signal.throwIfAborted();
      current += milliseconds;
    }),
    advance: (milliseconds: number) => { current += milliseconds; },
  };
}

describe('GitHub metadata client', () => {
  it.each([undefined, '', '  ', 'test-token-sentinel'])('uses fixed API host and required headers; token=%s', async (token) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(metadata));
    const result = await new GitHubClient({ fetcher, token }).getRepository(input);
    expect(result).toEqual({ owner: 'CanonicalOwner', name: 'CanonicalRepo', url: metadata.html_url, private: false, archived: true, defaultBranch: 'release/docs' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo');
    const headers = new Headers(options?.headers);
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('X-GitHub-Api-Version')).toBe('2026-03-10');
    expect(headers.get('User-Agent')).toBe('DocScout');
    expect(headers.get('Authorization')).toBe(token?.trim() ? `Bearer ${token}` : null);
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain('test-token-sentinel');
  });

  it('rejects private repositories even with a token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, private: true }));
    await expect(new GitHubClient({ fetcher, token: 'test-token' }).getRepository(input)).rejects.toMatchObject({ code: 'PRIVATE_REPOSITORY', status: 404 });
  });

  it.each([
    {}, null, { ...metadata, private: undefined }, { ...metadata, archived: 'false' },
    { ...metadata, owner: { login: '../evil' } }, { ...metadata, name: '..' },
    { ...metadata, html_url: 'https://evil.test/repo' },
    { ...metadata, default_branch: 123 }, { ...metadata, default_branch: '' },
  ])('rejects malformed upstream metadata: %j', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE', status: 502 });
  });

  it.each([
    [400, 'GITHUB_UPSTREAM_FAILURE', 502], [404, 'REPOSITORY_UNAVAILABLE', 404], [401, 'GITHUB_AUTH_ERROR', 502],
    [403, 'GITHUB_FORBIDDEN', 502], [429, 'GITHUB_COOLDOWN', 503], [501, 'GITHUB_UPSTREAM_FAILURE', 502],
    [302, 'GITHUB_UPSTREAM_FAILURE', 502],
  ])('maps HTTP %i to a safe application error', async (status, code, appStatus) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'leaked-token-sentinel' }, { status, headers: { Location: 'https://evil.test/' } }));
    try {
      await new GitHubClient({ fetcher, token: 'leaked-token-sentinel' }).getRepository(input);
      expect.fail('Expected a safe error');
    } catch (error) {
      expect(error).toMatchObject({ code, status: appStatus });
      expect(String(error)).not.toContain('leaked-token-sentinel');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries a selected 5xx response once and counts both attempts', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(Response.json(metadata));
    const budget = new ScanBudget();
    try {
      await expect(new GitHubClient({ fetcher }).getRepository(input, budget)).resolves.toMatchObject({ name: 'CanonicalRepo' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(budget.requestsUsed).toBe(2);
    } finally { budget.dispose(); }
  });

  it('retries one selected network failure and returns the successful retry', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce(Response.json(metadata));
    const budget = new ScanBudget();
    try {
      await expect(new GitHubClient({ fetcher }).getRepository(input, budget)).resolves.toMatchObject({ name: 'CanonicalRepo' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(budget.requestsUsed).toBe(2);
    } finally { budget.dispose(); }
  });

  it('stops after the second transient failure', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(metadata));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE', status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('suppresses a retry when the request budget has no remaining capacity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    const budget = new ScanBudget();
    for (let attempt = 0; attempt < 29; attempt += 1) budget.consumeRequest();
    try {
      await expect(new GitHubClient({ fetcher }).getRepository(input, budget)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE', status: 502 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(budget.requestsUsed).toBe(30);
    } finally { budget.dispose(); }
  });

  it('waits for a valid retry-after cooldown and retries within the deadline', async () => {
    const time = fakeTime();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(Response.json(metadata));
    const budget = new ScanBudget({ now: time.clock });
    try {
      await expect(new GitHubClient({ fetcher, clock: time.clock, now: time.now, sleep: time.sleep }).getRepository(input, budget))
        .resolves.toMatchObject({ name: 'CanonicalRepo' });
      expect(time.sleep).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(budget.requestsUsed).toBe(2);
    } finally { budget.dispose(); }
  });

  it('accepts a valid HTTP-date retry-after value', async () => {
    const time = fakeTime();
    const retryAt = new Date(time.clock() + 4_000).toUTCString();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': retryAt } }))
      .mockResolvedValueOnce(Response.json(metadata));
    await expect(new GitHubClient({ fetcher, clock: time.clock, now: time.now, sleep: time.sleep }).getRepository(input))
      .resolves.toMatchObject({ name: 'CanonicalRepo' });
    expect(time.sleep).toHaveBeenCalledWith(4_000, expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses a valid primary rate-limit reset time for its one retry', async () => {
    const time = fakeTime();
    const resetSeconds = Math.floor(time.clock() / 1000) + 3;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) } }))
      .mockResolvedValueOnce(Response.json(metadata));
    const budget = new ScanBudget({ now: time.clock });
    try {
      await expect(new GitHubClient({ fetcher, clock: time.clock, now: time.now, sleep: time.sleep }).getRepository(input, budget))
        .resolves.toMatchObject({ name: 'CanonicalRepo' });
      expect(time.sleep).toHaveBeenCalledWith(3000, expect.any(AbortSignal));
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { budget.dispose(); }
  });

  it('rejects malformed or unreasonably distant cooldown values without sleeping', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status: 429, headers: { 'retry-after': '-4', 'x-ratelimit-reset': '9999999999' },
    }));
    const time = fakeTime();
    await expect(new GitHubClient({ fetcher, clock: time.clock, sleep: time.sleep }).getRepository(input))
      .rejects.toMatchObject({ code: 'GITHUB_COOLDOWN', status: 503, retryAt: undefined });
    expect(time.sleep).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns retry guidance without sleeping when cooldown exceeds the remaining deadline', async () => {
    const time = fakeTime();
    const budget = new ScanBudget({ now: time.clock });
    time.advance(56_000);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '60' } }));
    try {
      await expect(new GitHubClient({ fetcher, clock: time.clock, now: time.now, sleep: time.sleep }).getRepository(input, budget))
        .rejects.toMatchObject({ code: 'GITHUB_COOLDOWN', status: 503, retryAt: expect.any(String) });
      expect(time.sleep).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { budget.dispose(); }
  });

  it('does not mistake a permission 403 with malformed retry guidance for a cooldown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'Resource not accessible by integration' }, {
      status: 403, headers: { 'retry-after': '-1', 'x-ratelimit-remaining': '10' },
    }));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_FORBIDDEN', status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry malformed successful responses', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{bad json'))
      .mockResolvedValueOnce(Response.json(metadata));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recognizes secondary limits without forwarding upstream text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'You have exceeded a secondary rate limit. secret' }, { status: 403 }));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_COOLDOWN', status: 503 });
  });

  it('maps transport failure without exposing its message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token in transport'));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE', status: 502, message: 'GitHub could not be reached. Please try again later.' });
  });

  it('rejects malformed JSON and a streamed response over 2 MiB', async () => {
    for (const [body, code] of [['{bad json', 'GITHUB_UPSTREAM_FAILURE'], ['x'.repeat(2 * 1024 * 1024 + 1), 'GITHUB_RESPONSE_TOO_LARGE']]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code });
    }
  });

  it('rejects forged unsafe segments before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new GitHubClient({ fetcher }).getRepository({ owner: '../evil', repo: 'repo' } as ValidatedRepository))
      .rejects.toMatchObject({ code: 'INVALID_REPOSITORY_URL' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a safe error when the request times out', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('secret upstream context', 'TimeoutError'));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_REQUEST_TIMEOUT', status: 504 });
  });

  it.each([
    ['same-host HTTPS', 'https://api.github.com/repos/new-owner/repo'],
    ['cross-host HTTPS', 'https://evil.test/repos/owner/repo'],
    ['non-HTTPS', 'http://api.github.com/repos/owner/repo'],
    ['credential-bearing cross-host', 'https://api.github.com@evil.test/repos/owner/repo'],
  ])('does not follow a %s GitHub redirect', async (_kind, location) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 301, headers: { Location: location },
    }));
    const client = new GitHubClient({ fetcher, token: 'sentinel' });
    const budget = client.createScanBudget();
    try {
      await expect(client.getRepository(input, budget)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
      expect(budget.requestsUsed).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo');
      expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer sentinel');
      expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
      expect(fetcher.mock.calls.slice(1).some(([url]) => new URL(String(url)).host !== 'api.github.com')).toBe(false);
    } finally {
      budget.dispose();
    }
  });
});
