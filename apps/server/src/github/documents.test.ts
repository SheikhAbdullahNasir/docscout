import { describe, expect, it } from 'vitest';
import type { RepositoryTreeEntry } from '@docscout/shared';
import { decodeContentsFile, selectDocumentCandidates } from './documents.js';

const sha = 'c'.repeat(40);

function blob(path: string, size = 10): RepositoryTreeEntry {
  return { path, type: 'blob', mode: '100644', sha, size };
}

function paths(entries: { path: string }[]): string[] {
  return entries.map(({ path }) => path);
}

describe('selected repository document paths', () => {
  it('prefers exact README.md while retaining differently cased Markdown README fallbacks', () => {
    const result = selectDocumentCandidates([
      blob('readme.md'), blob('README.markdown'), blob('README.md'), blob('README.txt'), blob('guide/README.md'),
    ]);

    expect(result.readme?.path).toBe('README.md');
  });

  it('selects a case-insensitive README name and deterministic alphabetical fallback', () => {
    expect(selectDocumentCandidates([blob('ReadMe.MD')]).readme?.path).toBe('ReadMe.MD');
    expect(selectDocumentCandidates([blob('README.markdown'), blob('README.mdown')]).readme?.path)
      .toBe('README.markdown');
  });

  it('reports no README candidate when no supported root Markdown README exists', () => {
    expect(selectDocumentCandidates([blob('README.txt'), blob('docs/README.md')]).readme).toBeUndefined();
  });

  it('uses root then .github then docs CONTRIBUTING.md precedence with case-insensitive filenames', () => {
    expect(selectDocumentCandidates([
      blob('docs/CONTRIBUTING.md'), blob('.github/contributing.MD'), blob('Contributing.md'),
    ]).contributing?.path).toBe('Contributing.md');
    expect(selectDocumentCandidates([
      blob('docs/CONTRIBUTING.md'), blob('.github/contributing.MD'),
    ]).contributing?.path).toBe('.github/contributing.MD');
    expect(selectDocumentCandidates([blob('docs/ConTriBuTiNg.Md')]).contributing?.path)
      .toBe('docs/ConTriBuTiNg.Md');
    expect(selectDocumentCandidates([blob('guide/CONTRIBUTING.md')]).contributing).toBeUndefined();
  });

  it('selects only the exact root package.json manifest', () => {
    expect(selectDocumentCandidates([blob('package.json'), blob('packages/app/package.json')]).packageJson?.path)
      .toBe('package.json');
    expect(selectDocumentCandidates([blob('Package.json'), blob('nested/package.json')]).packageJson)
      .toBeUndefined();
  });

  it('selects at most 12 docs Markdown files in deterministic path order', () => {
    const markdown = Array.from({ length: 14 }, (_, index) => blob(`docs/${String(13 - index).padStart(2, '0')}.md`));
    const result = selectDocumentCandidates([
      ...markdown, blob('docs/image.png'), blob('docs/readme.txt'), blob('Docs/not-selected.md'),
    ]);

    expect(paths(result.docs)).toEqual(Array.from({ length: 12 }, (_, index) => `docs/${String(index).padStart(2, '0')}.md`));
    expect(result.docsOmitted).toBe(true);
  });

  it('excludes selected guidance from additional docs', () => {
    const result = selectDocumentCandidates([
      blob('README.md'), blob('docs/CONTRIBUTING.md'), blob('docs/guide.md'), blob('docs/nested/topic.MD'),
    ]);

    expect(result.contributing?.path).toBe('docs/CONTRIBUTING.md');
    expect(paths(result.docs)).toEqual(['docs/guide.md', 'docs/nested/topic.MD']);
  });

  it('skips symlink and submodule candidates with reasons while selecting safe fallbacks', () => {
    const symlink: RepositoryTreeEntry = { path: 'README.md', type: 'blob', mode: '120000', sha, size: 8 };
    const submodule: RepositoryTreeEntry = { path: 'docs/topic.md', type: 'commit', mode: '160000', sha };
    const result = selectDocumentCandidates([symlink, blob('README.markdown'), submodule, blob('docs/guide.md')]);

    expect(result.readme?.path).toBe('README.markdown');
    expect(paths(result.docs)).toEqual(['docs/guide.md']);
    expect(result.skipped).toEqual([
      { path: 'docs/topic.md', category: 'docs', reason: 'submodule' },
      { path: 'README.md', category: 'readme', reason: 'symlink' },
    ]);
  });
});

describe('GitHub Contents API text decoding', () => {
  const candidate = { ...blob('docs/Guide With Space.md', 5), category: 'docs' as const, type: 'blob' as const, mode: '100644' as const };

  it('decodes a normal bounded Base64 UTF-8 file', () => {
    const result = decodeContentsFile({
      type: 'file', encoding: 'base64', content: Buffer.from('héllo').toString('base64'),
      size: Buffer.byteLength('héllo'), path: candidate.path, sha,
    }, candidate);

    expect(result).toEqual({ status: 'available', text: 'héllo', decodedSize: 6, reportedSize: 6 });
  });

  it.each([
    null,
    {},
    { type: 'dir', encoding: 'base64', content: '', size: 0, path: candidate.path, sha },
    { type: 'file', encoding: 'none', content: '', size: 0, path: candidate.path, sha },
    { type: 'file', encoding: 'base64', content: '%%%', size: 1, path: candidate.path, sha },
    { type: 'file', encoding: 'base64', content: 'YQ==', size: 1, path: 'docs/other.md', sha },
    { type: 'file', encoding: 'base64', content: 'YQ==', size: 1, path: candidate.path, sha: 'd'.repeat(40) },
    { type: 'file', encoding: 'base64', content: 'YQ==', size: 2, path: candidate.path, sha },
  ])('skips malformed or mismatched Contents API data: %j', (value) => {
    expect(decodeContentsFile(value, candidate)).toEqual({ status: 'skipped', reason: 'malformed' });
  });

  it('skips content over the 256 KiB decoded limit', () => {
    const text = 'x'.repeat(256 * 1024 + 1);
    expect(decodeContentsFile({
      type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'),
      size: text.length, path: candidate.path, sha,
    }, candidate)).toEqual({ status: 'skipped', reason: 'oversized' });
  });

  it('skips invalid UTF-8 and clearly binary text', () => {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0x00, 0x01, 0x02, 0x03])]) {
      expect(decodeContentsFile({
        type: 'file', encoding: 'base64', content: bytes.toString('base64'),
        size: bytes.length, path: candidate.path, sha,
      }, candidate)).toEqual({ status: 'skipped', reason: 'binary' });
    }
  });

  it('skips Git LFS pointer content', () => {
    const text = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n';
    expect(decodeContentsFile({
      type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'),
      size: text.length, path: candidate.path, sha,
    }, candidate)).toEqual({ status: 'skipped', reason: 'git-lfs-pointer' });
  });
});
