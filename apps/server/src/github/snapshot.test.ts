import { describe, expect, it, vi } from 'vitest';
import type { PublicRepositoryMetadata } from '@docscout/shared';
import { GitHubClient } from './client.js';
import { parseRepositoryUrl } from '../security/repositoryUrl.js';

const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);
const repository: PublicRepositoryMetadata = {
  owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
  private: false, archived: false, defaultBranch: 'main',
};
const commit = { sha: commitSha, commit: { tree: { sha: treeSha, url: 'https://evil.test/tree' } }, url: 'https://evil.test/commit' };
const entries = [
  { path: 'LICENSE.md', type: 'blob', mode: '100644', sha: blobSha, size: 12, url: 'https://evil.test/blob' },
  { path: 'Docs', type: 'tree', mode: '040000', sha: treeSha },
  { path: 'Docs/Guide.MD', type: 'blob', mode: '100755', sha: blobSha, size: 24 },
  { path: 'link', type: 'blob', mode: '120000', sha: blobSha, size: 8 },
  { path: 'vendor', type: 'commit', mode: '160000', sha: commitSha },
];
const tree = { sha: treeSha, tree: entries, truncated: false, url: 'https://evil.test/tree' };
const missingDocuments = {
  selectionComplete: true,
  readme: { status: 'unavailable', message: 'No supported root Markdown README found.' },
  contributing: { status: 'unavailable', message: 'Repository-local contribution guidance is unavailable.' },
  packageJson: { status: 'unavailable', message: 'No root package.json was found.' },
  docs: [], skipped: [], omissions: [],
};
const emptyIssues = {
  fetchedAt: expect.any(String), items: [], coverage: { complete: true, sampled: false, queries: [
    { label: 'good first issue', status: 'complete', pagesFetched: 1, capped: false,
      message: 'No matches were returned for the supported label query.' },
    { label: 'help wanted', status: 'complete', pagesFetched: 1, capped: false,
      message: 'No matches were returned for the supported label query.' },
  ] },
};

describe('default-branch snapshot', () => {
  it.each(['main', 'develop', 'release/docs', 'topic/#percent%'])('pins actual branch %s to commit and recursive tree', async (defaultBranch) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json(tree))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const result = await new GitHubClient({ fetcher, token: 'test-token' }).getSnapshot({ ...repository, defaultBranch });
    expect(result).toEqual({ status: 'ready', snapshot: {
      defaultBranch, commitSha, treeSha,
      tree: { entries: entries.map(({ url: _url, ...entry }) => { void _url; return entry; }), truncated: false, complete: true },
      documents: missingDocuments,
    }, issues: emptyIssues });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.github.com/repos/Canonical/Repo/commits/${encodeURIComponent(defaultBranch)}`,
      `https://api.github.com/repos/Canonical/Repo/git/trees/${treeSha}?recursive=1`,
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=1',
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=help%20wanted&sort=updated&direction=desc&per_page=100&page=1',
    ]);
    for (const [, options] of fetcher.mock.calls) {
      const headers = new Headers(options?.headers);
      expect(headers.get('X-GitHub-Api-Version')).toBe('2026-03-10');
      expect(headers.get('Accept')).toBe('application/vnd.github+json');
      expect(headers.get('User-Agent')).toBe('DocScout');
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(options?.redirect).toBe('manual');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('marks truncated trees incomplete without changing paths', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json({ ...tree, truncated: true }))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);
    expect(result).toMatchObject({ status: 'ready', snapshot: { tree: { complete: false, truncated: true, entries: [{ path: 'LICENSE.md' }, { path: 'Docs' }, { path: 'Docs/Guide.MD' }, { path: 'link' }, { path: 'vendor' }] } } });
  });

  it('represents an empty repository without fetching a tree', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ message: 'Git Repository is empty.' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    expect(await new GitHubClient({ fetcher }).getSnapshot(repository)).toEqual({ status: 'empty', snapshot: null,
      message: 'This repository has no commit snapshot or files to scan yet.', issues: emptyIssues });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([404, 409, 422, 500])('does not mistake commit HTTP %i for an empty repository', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'secret upstream conflict' }, { status }));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'COMMIT_LOOKUP_FAILED', status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['commit', 'tree'])('retains safe auth, cooldown and network errors during %s lookup', async (stage) => {
    for (const [status, code, appStatus] of [[401, 'GITHUB_AUTH_ERROR', 502], [403, 'GITHUB_FORBIDDEN', 502], [429, 'GITHUB_COOLDOWN', 503]] as const) {
      const fetcher = vi.fn<typeof fetch>();
      if (stage === 'tree') fetcher.mockResolvedValueOnce(Response.json(commit));
      fetcher.mockResolvedValueOnce(Response.json({ message: 'secret' }, { status }));
      await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code, status: appStatus });
    }
    const fetcher = vi.fn<typeof fetch>();
    if (stage === 'tree') fetcher.mockResolvedValueOnce(Response.json(commit));
    fetcher.mockRejectedValueOnce(new Error('secret network context'));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
  });

  it.each([404, 409, 500])('handles tree HTTP %i as failure', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json({ message: 'secret' }, { status }));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'TREE_LOOKUP_FAILED', status: 502 });
  });

  it.each([null, {}, { sha: '../evil', commit: commit.commit }, { sha: commitSha, commit: { tree: { sha: 'https://evil.test' } } }])('rejects malformed commit/SHA data: %j', async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'COMMIT_LOOKUP_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...tree, truncated: undefined }, { ...tree, sha: blobSha }, { ...tree, tree: null },
    ...[
      { ...entries[0], path: '../outside' }, { ...entries[0], path: '/root' },
      { ...entries[0], path: 'dir//file' }, { ...entries[0], path: 'a\\b' },
      { ...entries[0], size: -1 }, { ...entries[0], sha: 'unsafe' },
      { ...entries[0], mode: '160000' }, { ...entries[0], type: 'unknown' },
    ].map((entry) => ({ ...tree, tree: [entry] })),
  ])('rejects invalid tree evidence rather than claim complete coverage: %j', async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json(value));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'TREE_LOOKUP_FAILED' });
  });

  it.each(['../main', 'a/../b', 'refs//main', 'main?query', 'bad\\ref', 'bad\nref', ''])('rejects unsafe default branch %s before requests', async (defaultBranch) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new GitHubClient({ fetcher }).getSnapshot({ ...repository, defaultBranch })).rejects.toMatchObject({ code: 'COMMIT_LOOKUP_FAILED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps canonical metadata → commit → tree ordered and public-only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ owner: { login: repository.owner }, name: repository.name,
      html_url: repository.url, private: false, archived: false, default_branch: 'develop' }))
      .mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json(tree))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const client = new GitHubClient({ fetcher });
    const metadata = await client.getRepository(parseRepositoryUrl('https://github.com/input/repo'));
    await client.getSnapshot(metadata);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/input/repo', 'https://api.github.com/repos/Canonical/Repo/commits/develop',
      `https://api.github.com/repos/Canonical/Repo/git/trees/${treeSha}?recursive=1`,
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=1',
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=help%20wanted&sort=updated&direction=desc&per_page=100&page=1',
    ]);
  });

  it('allows a tree response over 2 MiB but rejects over 10 MiB while streaming', async () => {
    for (const [bytes, valid] of [[2 * 1024 * 1024 + 100, true], [10 * 1024 * 1024 + 1, false]] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
        .mockResolvedValueOnce(Response.json({ ...tree, ignoredPadding: 'x'.repeat(bytes) }))
        .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
      const result = new GitHubClient({ fetcher }).getSnapshot(repository);
      if (valid) await expect(result).resolves.toMatchObject({ status: 'ready' });
      else await expect(result).rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE' });
    }
  });

  it.each(['commit', 'tree'])('rejects redirects and reports cooldown during %s lookup', async (stage) => {
    for (const [status, headers, code] of [
      [302, { Location: 'https://evil.test/' }, stage === 'commit' ? 'COMMIT_LOOKUP_FAILED' : 'TREE_LOOKUP_FAILED'],
      [403, { 'x-ratelimit-remaining': '0', 'retry-after': '60' }, 'GITHUB_COOLDOWN'],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>();
      if (stage === 'tree') fetcher.mockResolvedValueOnce(Response.json(commit));
      fetcher.mockResolvedValueOnce(new Response(null, { status, headers }));
      await expect(new GitHubClient({ fetcher, token: 'sentinel' }).getSnapshot(repository)).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(stage === 'tree' ? 2 : 1);
    }
  });

  it('rejects duplicate tree paths rather than claim complete evidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json({ ...tree, tree: [entries[0], entries[0]] }));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code: 'TREE_LOOKUP_FAILED' });
  });
});
