import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client.js';
import { parseRepositoryUrl, type ValidatedRepository } from '../security/repositoryUrl.js';

const metadata = {
  owner: { login: 'CanonicalOwner' }, name: 'CanonicalRepo',
  html_url: 'https://github.com/CanonicalOwner/CanonicalRepo',
  private: false, archived: true, default_branch: 'release/docs',
  ignored_field: 'not returned',
};
const input = parseRepositoryUrl('https://github.com/owner/repo');

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
    [404, 'REPOSITORY_UNAVAILABLE', 404], [401, 'GITHUB_AUTH_ERROR', 502],
    [403, 'GITHUB_FORBIDDEN', 502], [429, 'GITHUB_COOLDOWN', 503],
    [500, 'GITHUB_UPSTREAM_FAILURE', 502], [302, 'GITHUB_UPSTREAM_FAILURE', 502],
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

  it.each([
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' },
    { 'retry-after': '60' },
  ])('distinguishes cooldown from forbidden on 403', async (headers) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403, headers }));
    await expect(new GitHubClient({ fetcher }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_COOLDOWN', status: 503, retryAt: expect.any(String) });
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

  it('does not follow even a same-host redirect or forward authorization', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 301, headers: { Location: 'https://api.github.com/repos/new-owner/repo' },
    }));
    await expect(new GitHubClient({ fetcher, token: 'sentinel' }).getRepository(input)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });
});
