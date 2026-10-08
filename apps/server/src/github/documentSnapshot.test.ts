import { describe, expect, it, vi } from 'vitest';
import type { PublicRepositoryMetadata, RepositoryTreeEntry } from '@docscout/shared';
import { GitHubClient } from './client.js';

const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);
const repository: PublicRepositoryMetadata = {
  owner: 'Canonical', name: 'Repo', url: 'https://github.com/Canonical/Repo',
  private: false, archived: false, defaultBranch: 'release/docs',
};
const commit = { sha: commitSha, commit: { tree: { sha: treeSha } } };

function blob(path: string, text: string): RepositoryTreeEntry {
  return { path, type: 'blob', mode: '100644', sha: blobSha, size: Buffer.byteLength(text) };
}

function contents(path: string, text: string, extra: Record<string, unknown> = {}) {
  return { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'),
    size: Buffer.byteLength(text), path, sha: blobSha, ...extra };
}

function fetchFor(entries: RepositoryTreeEntry[], responses: Response[] = [], truncated = false) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
    .mockResolvedValueOnce(Response.json({ sha: treeSha, tree: entries, truncated }));
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  fetcher.mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
  return fetcher;
}

describe('pinned selected repository documents', () => {
  it('fetches selected files from fixed Contents API paths at the exact commit and returns pinned source URLs', async () => {
    const readmeText = '# Read me\n\n```bash\nnpm run preview\n```';
    const selected = [
      blob('ReadMe.MD', readmeText), blob('.github/CONTRIBUTING.md', 'Please help'),
      blob('package.json', '{"scripts":{}}'), blob('docs/Guide #1.md', '# Guide'),
    ];
    const fetcher = fetchFor(selected, selected.map((entry, index) => Response.json(contents(entry.path, [readmeText, 'Please help', '{"scripts":{}}', '# Guide'][index]))));

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ status: 'ready', snapshot: {
      commitSha, tree: { complete: true, truncated: false },
      documents: {
        readme: { status: 'available', document: { path: 'ReadMe.MD', category: 'readme', text: readmeText, sha: blobSha } },
        contributing: { status: 'available', document: { path: '.github/CONTRIBUTING.md', category: 'contributing', text: 'Please help' } },
        packageJson: { status: 'available', document: { path: 'package.json', category: 'package-json', text: '{"scripts":{}}' } },
        docs: [{ path: 'docs/Guide #1.md', category: 'docs', text: '# Guide' }],
        skipped: [], omissions: [],
      },
      analysis: {
        markdownLinks: { findings: [] },
        npmScripts: {
          findings: [{
            type: 'possible-missing-npm-script',
            confidence: 'needs-review',
            difficulty: 'unknown',
            evidence: {
              sourceDocumentPath: 'ReadMe.MD',
              sourceUrl: `https://github.com/Canonical/Repo/blob/${commitSha}/ReadMe.MD`,
              sourceLine: 4,
              command: 'npm run preview',
              script: 'preview',
              manifestPath: 'package.json',
            },
          }],
          coverage: { status: 'checked', supportedCommandsChecked: 1, findingsProduced: 1 },
        },
      },
    } });
    expect(result.status === 'ready' && result.snapshot.documents.readme.status === 'available'
      ? result.snapshot.documents.readme.document.sourceUrl : undefined)
      .toBe(`https://github.com/Canonical/Repo/blob/${commitSha}/ReadMe.MD`);
    expect(result.status === 'ready' ? result.snapshot.documents.docs[0].sourceUrl : undefined)
      .toBe(`https://github.com/Canonical/Repo/blob/${commitSha}/docs/Guide%20%231.md`);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/Canonical/Repo/commits/release%2Fdocs',
      `https://api.github.com/repos/Canonical/Repo/git/trees/${treeSha}?recursive=1`,
      `https://api.github.com/repos/Canonical/Repo/contents/ReadMe.MD?ref=${commitSha}`,
      `https://api.github.com/repos/Canonical/Repo/contents/.github/CONTRIBUTING.md?ref=${commitSha}`,
      `https://api.github.com/repos/Canonical/Repo/contents/package.json?ref=${commitSha}`,
      `https://api.github.com/repos/Canonical/Repo/contents/docs/Guide%20%231.md?ref=${commitSha}`,
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=good%20first%20issue&sort=updated&direction=desc&per_page=100&page=1',
      'https://api.github.com/repos/Canonical/Repo/issues?state=open&labels=help%20wanted&sort=updated&direction=desc&per_page=100&page=1',
    ]);
  });

  it.each([false, true])('represents missing optional files without failure; truncated=%s', async (truncated) => {
    const result = await new GitHubClient({ fetcher: fetchFor([], [], truncated) }).getSnapshot(repository);

    expect(result).toMatchObject({ status: 'ready', snapshot: { tree: { complete: !truncated, truncated }, documents: {
      readme: truncated
        ? { status: 'unknown', message: expect.stringContaining('incomplete') }
        : { status: 'unavailable', message: 'No supported root Markdown README found.' },
      contributing: { status: truncated ? 'unknown' : 'unavailable' },
      packageJson: { status: truncated ? 'unknown' : 'unavailable' },
      docs: [], skipped: [], omissions: [], selectionComplete: !truncated,
    } } });
  });

  it('uses observed paths but marks document selection incomplete when a truncated tree could hide higher-priority paths', async () => {
    const selected = [
      blob('README.markdown', '# fallback'), blob('docs/CONTRIBUTING.md', 'docs guidance'),
      blob('docs/z.md', 'z'), blob('docs/a.md', 'a'),
    ];
    const fetcher = fetchFor(selected, [
      Response.json(contents('README.markdown', '# fallback')),
      Response.json(contents('docs/CONTRIBUTING.md', 'docs guidance')),
      Response.json(contents('docs/a.md', 'a')),
      Response.json(contents('docs/z.md', 'z')),
    ], true);

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ status: 'ready', snapshot: { tree: { complete: false }, documents: {
      selectionComplete: false,
      readme: { status: 'available', document: { path: 'README.markdown' } },
      contributing: { status: 'available', document: { path: 'docs/CONTRIBUTING.md' } },
      docs: [{ path: 'docs/a.md' }, { path: 'docs/z.md' }],
    } } });
  });

  it('skips malformed, oversized, binary, LFS, and missing optional files while retaining useful documents', async () => {
    const lfs = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n';
    const entries: RepositoryTreeEntry[] = [
      blob('README.md', 'missing'), blob('docs/a.md', 'good'), blob('docs/b.md', 'bad'),
      { ...blob('docs/c.md', ''), size: 256 * 1024 + 1 }, blob('docs/d.md', '\0bin'), blob('docs/e.md', lfs),
    ];
    const fetcher = fetchFor(entries, [
      Response.json({ message: 'not found' }, { status: 404 }),
      Response.json(contents('docs/a.md', 'good')),
      Response.json({ type: 'file', encoding: 'base64', content: '%%%', size: 3, path: 'docs/b.md', sha: blobSha }),
      Response.json(contents('docs/d.md', '\0bin')),
      Response.json(contents('docs/e.md', lfs)),
    ]);

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result).toMatchObject({ status: 'ready', snapshot: { documents: {
      readme: { status: 'unavailable' },
      docs: [{ path: 'docs/a.md', text: 'good' }],
      skipped: [
        { path: 'README.md', reason: 'unavailable' },
        { path: 'docs/b.md', reason: 'malformed' },
        { path: 'docs/c.md', reason: 'oversized' },
        { path: 'docs/d.md', reason: 'binary' },
        { path: 'docs/e.md', reason: 'git-lfs-pointer' },
      ],
    } } });
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it('stops before fetching content that would exceed the 2 MiB combined text budget', async () => {
    const readmeText = '';
    const docText = 'x'.repeat(256 * 1024);
    const entries = [blob('README.md', readmeText),
      ...Array.from({ length: 8 }, (_, index) => blob(`docs/${index}.md`, docText)), blob('docs/8.md', '')];
    const responses = [Response.json(contents('README.md', readmeText)),
      ...Array.from({ length: 8 }, (_, index) => Response.json(contents(`docs/${index}.md`, docText)))];
    const fetcher = fetchFor(entries, responses);

    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);

    expect(result.status).toBe('ready');
    const documents = result.status === 'ready' ? result.snapshot.documents : undefined;
    expect(documents?.docs.map(({ path }) => path)).toEqual(Array.from({ length: 8 }, (_, index) => `docs/${index}.md`));
    expect(documents?.skipped.map(({ path, reason }) => ({ path, reason }))).toEqual([
      { path: 'docs/8.md', reason: 'combined-content-limit' },
    ]);
    expect(documents?.omissions).toEqual(['combined-content-limit']);
    expect(fetcher).toHaveBeenCalledTimes(13);
  });

  it('preserves relevant authentication and cooldown errors from a selected content request', async () => {
    for (const [status, code] of [[401, 'GITHUB_AUTH_ERROR'], [403, 'GITHUB_FORBIDDEN'], [429, 'GITHUB_COOLDOWN']] as const) {
      const fetcher = fetchFor([blob('README.md', 'text')], [Response.json({ message: 'secret' }, { status })]);
      await expect(new GitHubClient({ fetcher }).getSnapshot(repository)).rejects.toMatchObject({ code });
    }
  });

  it.each([
    ['server error', () => Response.json({ message: 'secret' }, { status: 500 })],
    ['redirect', () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/file' } })],
    ['malformed JSON', () => new Response('{bad')],
  ])('turns optional content %s into an unavailable skip', async (_label, response) => {
    const responses = _label === 'server error' ? [response(), response()] : [response()];
    const result = await new GitHubClient({ fetcher: fetchFor([blob('README.md', 'text')], responses) })
      .getSnapshot(repository);
    expect(result).toMatchObject({ status: 'ready', snapshot: { documents: {
      readme: { status: 'unavailable' }, skipped: [{ path: 'README.md', reason: 'unavailable' }],
    } } });
  });

  it('marks oversized selected content unknown with a typed resource omission', async () => {
    const result = await new GitHubClient({ fetcher: fetchFor([blob('README.md', 'text')], [new Response('x'.repeat(2 * 1024 * 1024 + 1))]) })
      .getSnapshot(repository);
    expect(result).toMatchObject({ status: 'ready', scan: { status: 'partial', warnings: [{ code: 'GITHUB_RESPONSE_TOO_LARGE' }] },
      snapshot: { documents: {
        readme: { status: 'unknown' }, skipped: [{ path: 'README.md', reason: 'GITHUB_RESPONSE_TOO_LARGE' }],
        omissions: ['GITHUB_RESPONSE_TOO_LARGE'],
      } } });
  });

  it('turns an optional content transport failure into an unavailable skip', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(commit))
      .mockResolvedValueOnce(Response.json({ sha: treeSha, tree: [blob('README.md', 'text')], truncated: false }))
      .mockRejectedValueOnce(new Error('secret transport context'))
      .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([]));
    const result = await new GitHubClient({ fetcher }).getSnapshot(repository);
    expect(result).toMatchObject({ status: 'ready', snapshot: { documents: {
      readme: { status: 'unavailable' }, skipped: [{ path: 'README.md', reason: 'unavailable' }],
    } } });
  });
});
