import { describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshotResponse } from '@docscout/shared';
import { GitHubClient } from '../github/client.js';
import { boundBrowserResponse } from './browserBudget.js';

const repository = { owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
  private: false as const, archived: false, defaultBranch: 'main' };
const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);

async function resultWithReadme(text = '[Missing](missing.md)'): Promise<RepositorySnapshotResponse> {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } }))
    .mockResolvedValueOnce(Response.json({ sha: treeSha, truncated: false,
      tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: blobSha, size: Buffer.byteLength(text) }] }))
    .mockResolvedValueOnce(Response.json({ path: 'README.md', type: 'file', encoding: 'base64', sha: blobSha,
      size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') }))
    .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
  return { schemaVersion: 1, repository, ...await new GitHubClient({ fetcher }).getSnapshot(repository) };
}

function assertFits(result: RepositorySnapshotResponse) {
  const json = JSON.stringify(result);
  expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(3 * 1024 * 1024);
  expect(JSON.parse(json)).toMatchObject({ schemaVersion: 1, repository });
}

describe('browser analysis response budget', () => {
  it('keeps a normal result unchanged', async () => {
    const result = await resultWithReadme();
    const json = JSON.stringify(result);
    expect(result.scan).toEqual({ status: 'complete', githubRequests: 5, warnings: [] });
    expect(boundBrowserResponse(result)).toBe(result);
    expect(JSON.stringify(result)).toBe(json);
  });

  it('bounds escaped UTF-8 document previews and finding excerpts without altering source evidence', async () => {
    const result = await resultWithReadme();
    if (result.status !== 'ready' || result.snapshot.documents.readme.status !== 'available') throw new Error('fixture');
    const originalFinding = result.snapshot.analysis.findings[0];
    result.snapshot.documents.readme.document.text = '\t😀'.repeat(400_000);
    originalFinding.evidence.excerpt = '\t😀'.repeat(400_000);
    const bounded = boundBrowserResponse(result);
    assertFits(bounded);
    expect(bounded).toMatchObject({ scan: { status: 'partial', githubRequests: 5, warnings: [
      { code: 'BROWSER_RESPONSE_LIMIT', message: expect.any(String) },
    ] }, snapshot: { documents: { readme: { status: 'available', document: { previewTruncated: true } } },
      analysis: { findings: [{ id: originalFinding.id, type: 'missing-local-target', evidence: {
        sourceLine: 1, originalTarget: 'missing.md', normalizedTarget: 'missing.md', excerptTruncated: true,
      } }] } } });
    expect(bounded.status === 'ready' && bounded.snapshot.tree.complete).toBe(true);
    expect(result.snapshot.documents.readme.document.text.length).toBeGreaterThan(100_000);
  });

  it('preserves pinned metadata and findings when structural tree data cannot fit', async () => {
    const result = await resultWithReadme();
    if (result.status !== 'ready') throw new Error('fixture');
    const findings = structuredClone(result.snapshot.analysis.findings);
    result.snapshot.tree.entries = Array.from({ length: 3200 }, (_, index) => ({
      path: `${'a'.repeat(1000)}/${index}`, type: 'blob', mode: '100644', sha: blobSha,
    }));
    const bounded = boundBrowserResponse(result);
    assertFits(bounded);
    expect(bounded).toMatchObject({ status: 'ready', snapshot: { commitSha, treeSha, tree: { complete: false },
      analysis: { findings } }, scan: { status: 'partial', githubRequests: 5, responseOmissions: { treeEntries: 3200 } } });
  });

  it('discloses omitted whole records instead of truncating required finding or document identifiers', async () => {
    const result = await resultWithReadme();
    if (result.status !== 'ready' || result.snapshot.documents.readme.status !== 'available') throw new Error('fixture');
    result.snapshot.documents.readme.document.path = 'huge'.repeat(1_000_000);
    result.snapshot.analysis.findings[0].evidence.sourceUrl = `https://github.com/${'huge'.repeat(1_000_000)}`;
    const bounded = boundBrowserResponse(result);
    assertFits(bounded);
    expect(bounded).toMatchObject({ snapshot: { documents: { readme: { status: 'unknown' }, omissions: ['BROWSER_RESPONSE_LIMIT'] },
      analysis: { findings: [], coverage: { documentationFindingsProduced: 0, documentationFindingsOmitted: 1 } } },
      scan: { status: 'partial', githubRequests: 5, responseOmissions: { documents: 1, findings: 1 } } });
  });
});
