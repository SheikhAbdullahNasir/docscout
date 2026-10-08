import { describe, expect, it } from 'vitest';
import type {
  RepositoryDocument,
  RepositoryDocuments,
  RepositoryTreeEntry,
} from '@docscout/shared';
import { analyzeRepositoryMarkdownTargets } from './localLinks.js';

const commitSha = 'a'.repeat(40);

function document(path: string, text: string): RepositoryDocument {
  return {
    path,
    category: path === 'README.md' ? 'readme' : 'docs',
    sourceUrl: `https://github.com/example/repo/blob/${commitSha}/${path}`,
    text,
    sha: 'b'.repeat(40),
    decodedSize: Buffer.byteLength(text),
    reportedSize: Buffer.byteLength(text),
  };
}

function documents(...available: RepositoryDocument[]): RepositoryDocuments {
  const readme = available.find(({ category }) => category === 'readme');
  return {
    selectionComplete: true,
    readme: readme
      ? { status: 'available', document: readme }
      : { status: 'unavailable', message: 'No supported root Markdown README found.' },
    contributing: { status: 'unavailable', message: 'Repository-local contribution guidance is unavailable.' },
    packageJson: { status: 'unavailable', message: 'No root package.json was found.' },
    docs: available.filter(({ category }) => category === 'docs'),
    skipped: [],
    omissions: [],
  };
}

function entry(path: string, type: 'blob' | 'tree' = 'blob'): RepositoryTreeEntry {
  return {
    path,
    type,
    mode: type === 'tree' ? '040000' : '100644',
    sha: 'c'.repeat(40),
  };
}

function analyze(text: string, entries: RepositoryTreeEntry[], complete = true, path = 'README.md') {
  return analyzeRepositoryMarkdownTargets({
    documents: documents(document(path, text)),
    tree: { entries, complete, truncated: !complete },
  });
}

describe('repository-relative Markdown target analysis', () => {
  it('checks an existing relative file without producing a finding', () => {
    const result = analyze('Read the [setup guide](docs/setup.md).', [entry('README.md'), entry('docs/setup.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedLinksChecked: 1, uncheckedLinks: 0, unsupportedLinks: 0, findingsProduced: 0 });
  });

  it('produces deterministic evidence for a missing target only with a complete tree', () => {
    const markdown = ['# Setup', '', 'Read the [missing guide](docs/missing.md).'].join('\n');
    const complete = analyze(markdown, [entry('README.md')]);
    const incomplete = analyze(markdown, [entry('README.md')], false);

    expect(complete.findings).toHaveLength(1);
    expect(complete.findings[0]).toMatchObject({
      id: expect.stringMatching(/^missing-local-target:[a-f0-9]{16}$/),
      type: 'missing-local-target',
      confidence: 'high',
      difficulty: 'unknown',
      observation: 'Target is absent from the scanned repository snapshot.',
      evidence: {
        sourceDocumentPath: 'README.md',
        sourceUrl: `https://github.com/example/repo/blob/${commitSha}/README.md`,
        sourceLine: 3,
        excerpt: 'Read the [missing guide](docs/missing.md).',
        linkText: 'missing guide',
        originalTarget: 'docs/missing.md',
        normalizedTarget: 'docs/missing.md',
      },
    });
    expect(complete.findings[0].verificationSteps.join(' ')).toMatch(/generated documentation|site\/router path|build-time documentation behavior|project convention/i);
    expect(complete.findings[0].limitations.join(' ')).toMatch(/snapshot/i);

    expect(incomplete.findings).toEqual([]);
    expect(incomplete.coverage).toMatchObject({
      supportedLinksChecked: 0,
      uncheckedLinks: 1,
      uncheckedByReason: { incompleteTree: 1, unresolvedReference: 0 },
      findingsProduced: 0,
    });
  });

  it('uses AST links, resolves references, and ignores link-looking code', () => {
    const markdown = [
      '`[inline](missing-inline.md)`',
      '',
      '```md',
      '[fenced](missing-fenced.md)',
      '[fenced reference][missing-code]',
      '```',
      '',
      'Use the [resolved guide][guide] and [unknown *formatted* guide][missing].',
      'Escaped \\![not an image][missing-image] and \\[not a link][missing-link].',
      '',
      '[guide]: docs/guide.md',
    ].join('\n');

    const result = analyze(markdown, [entry('README.md'), entry('docs/guide.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({
      supportedLinksChecked: 1,
      uncheckedLinks: 1,
      uncheckedByReason: { incompleteTree: 0, unresolvedReference: 1, fragmentAnchor: 0 },
    });
  });

  it('resolves nested, root-relative, query, and fragment targets with POSIX semantics', () => {
    const markdown = [
      '[parent](../guide/install.md)',
      '[root](/docs/file.md)',
      '[query](local.md?mode=basic)',
      '[fragment](local.md#installation)',
    ].join('\n');
    const result = analyze(markdown, [
      entry('docs/nested/source.md'), entry('docs/guide/install.md'), entry('docs/file.md'), entry('docs/nested/local.md'),
    ], true, 'docs/nested/source.md');

    expect(result.findings).toEqual([]);
    expect(result.coverage.supportedLinksChecked).toBe(4);
    expect(result.coverage.uncheckedLinks).toBe(1);
    expect(result.coverage.uncheckedByReason.fragmentAnchor).toBe(1);
    expect(result.coverage.limitations.join(' ')).toMatch(/fragment|anchor/i);
    expect(result.coverage.limitations.join(' ')).toMatch(/query/i);
  });

  it('accepts known directory targets and respects exact Git-tree case', () => {
    const result = analyze([
      '[directory](docs/)',
      '[exact](Docs/Guide.md)',
      '[wrong case](docs/guide.md)',
    ].join('\n'), [entry('README.md'), entry('docs', 'tree'), entry('Docs', 'tree'), entry('Docs/Guide.md')]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence).toMatchObject({ linkText: 'wrong case', normalizedTarget: 'docs/guide.md' });
    expect(result.coverage.supportedLinksChecked).toBe(3);
  });

  it('classifies external and unsupported categories without repository lookup findings', () => {
    const markdown = [
      '[https](https://example.com/a)',
      '[protocol relative](//example.com/a)',
      '[email](mailto:maintainer@example.com)',
      '[anchor](#install)',
      '[ftp](ftp://example.com/file)',
      '[javascript](javascript:alert(1))',
      '[data](data:text/html,unsafe)',
      '![image](docs/image.png)',
    ].join('\n');
    const result = analyze(markdown, [entry('README.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedLinksChecked: 0, uncheckedLinks: 0, unsupportedLinks: 8 });
    expect(result.coverage.unsupportedByReason).toEqual({
      images: 1,
      external: 1,
      protocolRelative: 1,
      mailto: 1,
      pureAnchor: 1,
      otherScheme: 3,
      suspiciousTarget: 0,
    });
  });

  it.each([
    ['root traversal', '../../outside.md'],
    ['backslash', 'docs\\guide.md'],
    ['NUL', 'docs/%00guide.md'],
    ['encoded newline', 'docs/%0Aguide.md'],
    ['encoded tab', 'docs/%09guide.md'],
    ['encoded DEL', 'docs/%7Fguide.md'],
    ['encoded slash', 'docs%2Fguide.md'],
    ['encoded backslash', 'docs%5Cguide.md'],
    ['double-encoded separator', 'docs%252Fguide.md'],
    ['invalid encoding', 'docs/%ZZguide.md'],
  ])('marks suspicious %s targets unsupported instead of missing', (_label, target) => {
    const result = analyze(`[guide](${target})`, [entry('README.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedLinksChecked: 0, uncheckedLinks: 0, unsupportedLinks: 1 });
    expect(result.coverage.unsupportedByReason.suspiciousTarget).toBe(1);
  });

  it('decodes a safe encoded path exactly once before exact lookup', () => {
    const result = analyze('[guide](docs/My%20Guide.md)', [entry('README.md'), entry('docs/My Guide.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage.supportedLinksChecked).toBe(1);
  });

  it('removes query and fragment data before applying path safety checks', () => {
    const result = analyze('[guide](docs/guide.md?next=%2Foutside#part%5Cname)', [
      entry('README.md'), entry('docs/guide.md'),
    ]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({
      supportedLinksChecked: 1,
      uncheckedLinks: 1,
      unsupportedLinks: 0,
      uncheckedByReason: { fragmentAnchor: 1 },
    });
  });

  it('does not turn a destination that decodes to an external URI into a missing repository path', () => {
    const result = analyze('[encoded external](%68ttps://example.com/guide)', [entry('README.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedLinksChecked: 0, unsupportedLinks: 1 });
    expect(result.coverage.unsupportedByReason.external).toBe(1);
  });

  it('deduplicates repeated missing observations by type, source, and normalized target', () => {
    const first = analyze('[one](docs/missing.md) and [two](docs/./missing.md)', [entry('README.md')]);
    const second = analyze('[one](docs/missing.md) and [two](docs/./missing.md)', [entry('README.md')]);

    expect(first.findings).toHaveLength(1);
    expect(first.findings[0].id).toBe(second.findings[0].id);
    expect(first.coverage).toMatchObject({ supportedLinksChecked: 2, findingsProduced: 1 });
  });

  it('keeps generated or router-style absences qualified by deterministic guidance', () => {
    const result = analyze('[Guide](/guide/getting-started)', [entry('README.md')]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      title: 'Repository-relative target is absent from the scanned snapshot',
      whyItMatters: expect.stringMatching(/may be unable to open/i),
    });
    expect(result.findings[0].verificationSteps.join(' ')).toMatch(/generated documentation|site\/router path|build-time documentation behavior|project convention/i);
    expect(result.findings[0].limitations.join(' ')).toMatch(/does not establish.*broken|correct replacement|maintainer/i);
  });

  it('bounds finding output and evidence while retaining complete check coverage', () => {
    const markdown = Array.from({ length: 51 }, (_, index) =>
      `[${'guide'.repeat(60)} ${index}](docs/missing-${index}.md)`).join('\n');
    const result = analyze(markdown, [entry('README.md')]);

    expect(result.findings).toHaveLength(50);
    expect(result.findings[0].evidence.linkText.length).toBeLessThanOrEqual(240);
    expect(result.coverage).toMatchObject({
      supportedLinksChecked: 51,
      findingsProduced: 50,
      findingsOmitted: 1,
    });
  });

  it('handles deeply nested valid Markdown without overflowing the JavaScript stack', () => {
    const markdown = `${'> '.repeat(6_000)}[guide](docs/guide.md)`;
    const result = analyze(markdown, [entry('README.md'), entry('docs/guide.md')]);

    expect(result.findings).toEqual([]);
    expect(result.coverage.supportedLinksChecked).toBe(1);
  });

  it('retains evidence excerpts for CR-only Markdown source lines', () => {
    const result = analyze('first line\r[missing](docs/missing.md)', [entry('README.md')]);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence).toMatchObject({
      sourceLine: 2,
      excerpt: '[missing](docs/missing.md)',
    });
  });

  it('keeps pathologically link-dense Markdown bounded with truthful document coverage', { timeout: 1_000 }, () => {
    const parsed = Array.from({ length: 2_000 }, () => '[x](a)').join(' ');
    const unresolved = Array.from({ length: 2_000 }, () => '[x][y]').join(' ');
    const result = analyze(`${parsed}\n${unresolved}`, [entry('README.md'), entry('a')]);

    expect(result.coverage).toMatchObject({
      documentsAnalyzed: 0,
      documentsUnchecked: 1,
      supportedLinksChecked: 0,
      uncheckedDocumentsByReason: { parserSafetyLimit: 1 },
    });
    expect(result.findings).toEqual([]);
  });
});
