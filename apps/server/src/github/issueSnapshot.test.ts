import { describe, expect, it, vi } from 'vitest';
import type { PublicRepositoryMetadata } from '@docscout/shared';
import { GitHubClient } from './client.js';

const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const repository: PublicRepositoryMetadata = {
  owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
  private: false, archived: true, defaultBranch: 'main',
};
const commit = { sha: commitSha, commit: { tree: { sha: treeSha } } };
const tree = { sha: treeSha, tree: [], truncated: false };

function issue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/Canonical/Repo/issues/${number}`,
    state: 'open',
    labels: [{ name: 'good first issue' }],
    updated_at: '2026-10-03T10:20:30Z',
    assignees: [],
    body: '  First line\n\nSecond   line  ',
    ...extra,
  };
}

function pageLink(page: number, label: string, host = 'api.github.com') {
  const params = new URLSearchParams({
    state: 'open', labels: label, sort: 'updated', direction: 'desc', per_page: '100', page: String(page),
  });
  return `<https://${host}/repos/Canonical/Repo/issues?${params.toString()}>; rel="next"`;
}

function fetchForIssues(...responses: Array<Response | Error>) {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(commit))
    .mockResolvedValueOnce(Response.json(tree));
  for (const response of responses) {
    if (response instanceof Error) fetcher.mockRejectedValueOnce(response);
    else fetcher.mockResolvedValueOnce(response);
  }
  return fetcher;
}

describe('bounded labeled issue retrieval', () => {
  it('retrieves labeled issues even when the repository has no commit snapshot', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ message: 'Git Repository is empty.' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json([issue(7)]))
      .mockResolvedValueOnce(Response.json([]));

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({
      status: 'empty',
      snapshot: null,
      analysis: {
        findings: [{ type: 'labeled-issue', evidence: { issueNumber: 7 } }],
        labeledIssues: {
          findings: [{ type: 'labeled-issue', evidence: { issueNumber: 7 } }],
          coverage: { eligibleIssues: 1, findingsProduced: 1, findingsOmitted: 0 },
        },
      },
      issues: { items: [{ number: 7 }], coverage: { complete: true } },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('queries supported labels separately, filters PRs, deduplicates issues, and retains exact issue evidence', async () => {
    const bothLabels = issue(11, {
      labels: [{ name: 'good first issue' }, { name: 'help wanted' }, { name: 'docs' }],
      body: 'x'.repeat(600),
    });
    const pullRequest = issue(12, { pull_request: { url: 'https://api.github.com/repos/Canonical/Repo/pulls/12' } });
    const assigned = issue(13, {
      labels: [{ name: 'help wanted' }],
      assignees: [{ login: 'octocat' }, { login: 'hubot' }],
      body: null,
    });
    const fetcher = fetchForIssues(
      Response.json([bothLabels, pullRequest]),
      Response.json([bothLabels, assigned]),
    );

    const result = await new GitHubClient({ fetcher, now: () => new Date('2026-10-03T12:00:00Z') })
      .getSnapshot(repository);

    expect(result).toMatchObject({
      status: 'ready',
      snapshot: {
        analysis: {
          labeledIssues: {
            findings: [
              {
                type: 'labeled-issue',
                title: 'Maintainer-labeled good first issue',
                confidence: 'maintainer-label',
                difficulty: 'unknown',
                evidence: {
                  issueNumber: 11,
                  sourceUrl: 'https://github.com/Canonical/Repo/issues/11',
                  labels: ['good first issue', 'help wanted', 'docs'],
                  assigned: false,
                  excerpt: 'x'.repeat(500),
                },
                limitations: expect.arrayContaining([expect.stringMatching(/archived/i)]),
              },
              {
                type: 'labeled-issue',
                title: 'Maintainer-labeled help wanted issue',
                evidence: { issueNumber: 13, assigned: true, assignees: ['octocat', 'hubot'] },
                limitations: expect.arrayContaining([expect.stringMatching(/assigned/i), expect.stringMatching(/archived/i)]),
              },
            ],
            coverage: {
              eligibleIssues: 2,
              findingsProduced: 2,
              findingsOmitted: 0,
              issueRetrieval: { complete: true, sampled: false },
            },
          },
        },
      },
      issues: {
        fetchedAt: '2026-10-03T12:00:00.000Z',
        items: [
          {
            number: 11,
            title: 'Issue 11',
            url: 'https://github.com/Canonical/Repo/issues/11',
            labels: ['good first issue', 'help wanted', 'docs'],
            updatedAt: '2026-10-03T10:20:30.000Z',
            assignees: [],
            assigned: false,
            bodyExcerpt: 'x'.repeat(500),
          },
          {
            number: 13,
            labels: ['help wanted'],
            assignees: ['octocat', 'hubot'],
            assigned: true,
            bodyExcerpt: '',
          },
        ],
        coverage: {
          complete: true,
          sampled: false,
          queries: [
            { label: 'good first issue', status: 'complete', pagesFetched: 1, capped: false },
            { label: 'help wanted', status: 'complete', pagesFetched: 1, capped: false },
          ],
        },
      },
    });
    expect(fetcher.mock.calls.slice(2).map(([url]) => url)).toEqual([
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=1',
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=help%20wanted&sort=updated&direction=desc&per_page=100&page=1',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('describes empty label queries narrowly without claiming there are no beginner opportunities', async () => {
    const result = await new GitHubClient({ fetcher: fetchForIssues(Response.json([]), Response.json([])) })
      .getSnapshot(repository);

    expect(result).toMatchObject({ issues: { items: [], coverage: { complete: true, queries: [
      { label: 'good first issue', message: 'No matches were returned for the supported label query.' },
      { label: 'help wanted', message: 'No matches were returned for the supported label query.' },
    ] } } });
    expect(JSON.stringify(result)).not.toMatch(/no beginner-friendly issues|no beginner opportunities/i);
  });

  it('follows a validated second page and discloses sampling when a third page remains', async () => {
    const fetcher = fetchForIssues(
      Response.json([issue(1)], { headers: { Link: pageLink(2, 'good first issue') } }),
      Response.json([issue(2)], { headers: { Link: pageLink(3, 'good first issue') } }),
      Response.json([]),
    );

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ issues: {
      items: [{ number: 1 }, { number: 2 }],
      coverage: { complete: false, sampled: true, queries: [
        { label: 'good first issue', status: 'complete', pagesFetched: 2, capped: true,
          message: 'Issue results sampled because another page was available after the two-page limit.' },
        { label: 'help wanted', status: 'complete', pagesFetched: 1, capped: false },
      ] },
    } });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.map(([url]) => String(url))).not.toContain(expect.stringContaining('page=3'));
  });

  it('rejects an untrusted pagination host and retains explicit partial coverage', async () => {
    const fetcher = fetchForIssues(
      Response.json([issue(21)], { headers: { Link: pageLink(2, 'good first issue', 'evil.test') } }),
      Response.json([]),
    );

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ issues: {
      items: [{ number: 21 }],
      coverage: { complete: false, sampled: false, queries: [
        { label: 'good first issue', status: 'partial', pagesFetched: 1, capped: false,
          message: 'Issue coverage for this label is incomplete because GitHub pagination was invalid.' },
        { label: 'help wanted', status: 'complete', pagesFetched: 1 },
      ] },
    } });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('marks malformed issue data as a failed label query while retaining the completed label query', async () => {
    const fetcher = fetchForIssues(Response.json({ items: [] }), Response.json([issue(31, {
      labels: [{ name: 'help wanted' }],
    })]));

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ issues: {
      items: [{ number: 31 }],
      coverage: { complete: false, queries: [
        { label: 'good first issue', status: 'failed', pagesFetched: 0, capped: false,
          message: 'Issue coverage for this label is unavailable because GitHub returned invalid issue data.' },
        { label: 'help wanted', status: 'complete', pagesFetched: 1 },
      ] },
    } });
  });

  it('rejects a permissively parseable timestamp that is not GitHub issue timestamp data', async () => {
    const fetcher = fetchForIssues(Response.json([issue(32, { updated_at: '2026' })]), Response.json([]));

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ issues: { items: [], coverage: { complete: false, queries: [
      { label: 'good first issue', status: 'failed', pagesFetched: 0,
        message: 'Issue coverage for this label is unavailable because GitHub returned invalid issue data.' },
      { label: 'help wanted', status: 'complete', pagesFetched: 1 },
    ] } } });
  });

  it('retains a successful label stream when the other stream has a bounded upstream failure', async () => {
    const fetcher = fetchForIssues(Response.json([issue(41)]), Response.json({ message: 'secret' }, { status: 500 }));

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ issues: {
      items: [{ number: 41 }],
      coverage: { complete: false, queries: [
        { label: 'good first issue', status: 'complete', pagesFetched: 1 },
        { label: 'help wanted', status: 'failed', pagesFetched: 0,
          message: 'Issue coverage for this label is unavailable because GitHub could not complete the request.' },
      ] },
    } });
  });

  it.each([
    [401, {}, 'GITHUB_AUTH_ERROR'],
    [403, { 'x-ratelimit-remaining': '0', 'retry-after': '60' }, 'GITHUB_COOLDOWN'],
    [429, {}, 'GITHUB_COOLDOWN'],
  ])('does not downgrade fatal issue HTTP %i failures into empty or partial results', async (status, headers, code) => {
    const fetcher = fetchForIssues(Response.json([issue(51)]), new Response('', { status, headers }));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code });
  });

  it('fails safely when neither supported label query has usable coverage', async () => {
    const fetcher = fetchForIssues(Response.json({ invalid: true }), new Error('network secret'));
    await expect(new GitHubClient({ fetcher }).getSnapshot(repository))
      .rejects.toMatchObject({ code: 'GITHUB_UPSTREAM_FAILURE', status: 502 });
  });
});
