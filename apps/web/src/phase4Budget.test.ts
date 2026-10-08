import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RepositorySnapshotResponse } from '@docscout/shared';
import { GitHubClient } from '../../server/src/github/client.js';
import { boundBrowserResponse } from '../../server/src/routes/browserBudget.js';
import { isSnapshotResponse, Results } from './App.js';

async function fixture(): Promise<RepositorySnapshotResponse> {
  const repository = { owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
    private: false as const, archived: false, defaultBranch: 'main' };
  const commitSha = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } }))
    .mockResolvedValueOnce(Response.json({ sha: treeSha, tree: [], truncated: false }))
    .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
  return { schemaVersion: 1, repository, ...await new GitHubClient({ fetcher }).getSnapshot(repository),
    scannedAt: new Date(0).toISOString(), cached: false };
}

describe('Phase 4A browser contract and partial coverage', () => {
  it('continues accepting normal Phase 1–3 results', async () => {
    const result = await fixture();
    expect(isSnapshotResponse(result)).toBe(true);
    expect(isSnapshotResponse({ ...result, cached: true })).toBe(true);
    expect(renderToStaticMarkup(createElement(Results, { result }))).toContain('No suggestions found in the checked scope.');
  });

  it('accepts deadline-skipped analysis and displays its partial warning and announcement', async () => {
    const result = await fixture();
    if (result.status !== 'ready') throw new Error('fixture');
    result.snapshot.analysis.npmScripts.coverage.skipReason = 'scan-deadline';
    result.scan = { status: 'partial', githubRequests: 4,
      warnings: [{ code: 'SCAN_DEADLINE_EXCEEDED', message: 'The scan reached its 60-second deadline.' }] };
    expect(isSnapshotResponse(result)).toBe(true);
    const html = renderToStaticMarkup(createElement(Results, { result }));
    expect(html).toContain('The scan reached its 60-second deadline.');
    expect(html).toContain('Repository analysis returned partial coverage.');
    expect(html).toContain('scan deadline was reached before document parsing');
  });

  it('accepts bounded tree delivery and explains its resource omission as plain text', async () => {
    const result = await fixture();
    if (result.status !== 'ready') throw new Error('fixture');
    result.snapshot.tree.entries = [{ path: 'x'.repeat(3 * 1024 * 1024), type: 'blob', mode: '100644', sha: 'c'.repeat(40) }];
    const bounded = boundBrowserResponse(result, 5);
    expect(isSnapshotResponse(bounded)).toBe(true);
    const html = renderToStaticMarkup(createElement(Results, { result: bounded }));
    expect(html).toContain('browser response within 3 MiB');
    expect(html).toContain('Repository tree: incomplete');
    expect(html).toContain('Partial coverage');
  });

  it('rejects malformed resource coverage rather than accepting it as a normal result', async () => {
    const result = await fixture();
    expect(isSnapshotResponse({ ...result, scan: { status: 'partial', githubRequests: -1, warnings: [] } })).toBe(false);
    expect(isSnapshotResponse({ ...result, scan: { status: 'partial', githubRequests: 5, warnings: [{ code: 'x', message: {} }] } })).toBe(false);
    expect(isSnapshotResponse({ ...result, scan: { status: 'partial', githubRequests: 5, warnings: [], responseOmissions: { findings: 'all' } } })).toBe(false);
  });
});
