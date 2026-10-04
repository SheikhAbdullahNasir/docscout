import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { GitHubClient } from '../github/client.js';

const metadata = { owner: { login: 'Canonical' }, name: 'Repo', html_url: 'https://github.com/Canonical/Repo', private: false, archived: false, default_branch: 'release/docs' };
const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const commit = { sha: commitSha, commit: { tree: { sha: treeSha } } };
const input = { repositoryUrl: 'https://github.com/input/repo' };

describe('snapshot endpoint', () => {
  it.each([false, true])('returns pinned data and explicit coverage; truncated=%s', async (truncated) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json({ sha: treeSha, truncated, tree: [] }))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository/snapshot').send(input);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ schemaVersion: 1, repository: { owner: 'Canonical', name: 'Repo', url: metadata.html_url, private: false, archived: false, defaultBranch: 'release/docs' }, status: 'ready', snapshot: {
      defaultBranch: 'release/docs', commitSha, treeSha, tree: { entries: [], truncated, complete: !truncated },
      documents: {
        selectionComplete: !truncated,
        readme: truncated
          ? { status: 'unknown', message: 'README availability is unknown because tree path coverage is incomplete.' }
          : { status: 'unavailable', message: 'No supported root Markdown README found.' },
        contributing: truncated
          ? { status: 'unknown', message: 'Repository-local contribution guidance availability is unknown because tree path coverage is incomplete.' }
          : { status: 'unavailable', message: 'Repository-local contribution guidance is unavailable.' },
        packageJson: truncated
          ? { status: 'unknown', message: 'Root package.json availability is unknown because tree path coverage is incomplete.' }
          : { status: 'unavailable', message: 'No root package.json was found.' },
        docs: [], skipped: [], omissions: [],
      },
      analysis: { markdownLinks: {
        findings: [],
        coverage: {
          documentsAnalyzed: 0,
          documentsUnchecked: 0,
          supportedLinksChecked: 0,
          uncheckedLinks: 0,
          unsupportedLinks: 0,
          findingsProduced: 0,
          findingsOmitted: 0,
          uncheckedByReason: { incompleteTree: 0, unresolvedReference: 0, fragmentAnchor: 0 },
          uncheckedDocumentsByReason: { parserSafetyLimit: 0 },
          unsupportedByReason: {
            images: 0, external: 0, protocolRelative: 0, mailto: 0,
            pureAnchor: 0, otherScheme: 0, suspiciousTarget: 0,
          },
          limitations: [
            'Image targets are unsupported and are not checked.',
            'External URLs, protocol-relative URLs, mail links, pure anchors, other URI schemes, unresolved references, and suspicious encodings are not checked.',
            'Query strings are removed before repository-path lookup; application or router query behavior is not interpreted.',
            'Fragments are removed before repository-path lookup; heading anchors are not verified.',
            'Missing-target findings require a complete recursive repository tree.',
            'Documentation findings are limited to the first 50 deterministic observations; additional unique observations are counted as omitted.',
            'A selected document with more than 1,000 potential link openers is left unchecked to keep untrusted Markdown parsing bounded.',
          ],
        },
      }, npmScripts: {
        findings: [],
        coverage: expect.objectContaining({
          status: 'skipped', skipReason: 'readme-unavailable', supportedCommandsChecked: 0,
          commandsSkipped: 0, findingsProduced: 0, findingsOmitted: 0,
        }),
      } },
    }, issues: {
      fetchedAt: expect.any(String), items: [], coverage: { complete: true, sampled: false, queries: [
        { label: 'good first issue', status: 'complete', pagesFetched: 1, capped: false,
          message: 'No matches were returned for the supported label query.' },
        { label: 'help wanted', status: 'complete', pagesFetched: 1, capped: false,
          message: 'No matches were returned for the supported label query.' },
      ] },
    } });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every(([url]) => !/\/contents\//.test(String(url)))).toBe(true);
  });

  it('preserves metadata with null snapshot when GitHub reports empty', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ message: 'Git Repository is empty.' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository/snapshot').send(input);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ repository: { owner: 'Canonical', defaultBranch: 'release/docs' }, status: 'empty', snapshot: null, message: expect.any(String) });
    expect(response.body).toMatchObject({ issues: { items: [], coverage: { complete: true } } });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('rejects private metadata before requesting commits', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, private: true }));
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository/snapshot').send(input);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRIVATE_REPOSITORY');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before requesting metadata', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository/snapshot').send({ repositoryUrl: 'https://evil.test/owner/repo' });
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized browser results without silently returning partial paths as complete', async () => {
    const entries = Array.from({ length: 3200 }, (_, index) => ({ path: `${'a'.repeat(1000)}/${index}`, type: 'blob', mode: '100644', sha: commitSha }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(commit)).mockResolvedValueOnce(Response.json({ sha: treeSha, truncated: false, tree: entries }))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository/snapshot').send(input);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('TREE_LOOKUP_FAILED');
    expect(response.body.snapshot).toBeUndefined();
  });

  it.each(['commit', 'tree'])('returns safe serialized failure for %s', async (stage) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata));
    if (stage === 'tree') fetcher.mockResolvedValueOnce(Response.json(commit));
    fetcher.mockResolvedValueOnce(Response.json({ message: 'token-sentinel' }, { status: 404 }));
    const response = await request(createApp({ github: new GitHubClient({ fetcher, token: 'token-sentinel' }) })).post('/api/repository/snapshot').send(input);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe(stage === 'commit' ? 'COMMIT_LOOKUP_FAILED' : 'TREE_LOOKUP_FAILED');
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.text).not.toContain('token-sentinel');
    expect(response.text).not.toContain('stack');
  });
});
