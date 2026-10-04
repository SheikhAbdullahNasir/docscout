import { describe, expect, it } from 'vitest';
import type { RepositoryDocument, RepositoryDocuments } from '@docscout/shared';
import { analyzeReadmeNpmScripts } from './npmScripts.js';

const commitSha = 'a'.repeat(40);

function document(path: string, category: RepositoryDocument['category'], text: string): RepositoryDocument {
  return {
    path,
    category,
    sourceUrl: `https://github.com/example/repo/blob/${commitSha}/${path}`,
    text,
    sha: 'b'.repeat(40),
    decodedSize: Buffer.byteLength(text),
    reportedSize: Buffer.byteLength(text),
  };
}

function documents(readmeText: string, packageJsonText: string): RepositoryDocuments {
  return {
    selectionComplete: true,
    readme: { status: 'available', document: document('README.md', 'readme', readmeText) },
    contributing: { status: 'unavailable', message: 'Repository-local contribution guidance is unavailable.' },
    packageJson: { status: 'available', document: document('package.json', 'package-json', packageJsonText) },
    docs: [],
    skipped: [],
    omissions: [],
  };
}

function analyze(readmeText: string, scripts: Record<string, string> = {}) {
  return analyzeReadmeNpmScripts({ documents: documents(readmeText, JSON.stringify({ scripts })) });
}

describe('README npm script analysis', () => {
  it('reports an explicit missing npm run script as needs-review evidence', () => {
    const result = analyzeReadmeNpmScripts({
      documents: documents([
        '# Setup',
        '',
        '```bash',
        'npm run preview',
        '```',
      ].join('\n'), JSON.stringify({ scripts: { build: 'vite build' } })),
    });

    expect(result.findings).toEqual([{
      id: expect.stringMatching(/^possible-missing-npm-script:[a-f0-9]{16}$/),
      type: 'possible-missing-npm-script',
      title: 'README npm script may not match the root package.json',
      confidence: 'needs-review',
      difficulty: 'unknown',
      evidence: {
        sourceDocumentPath: 'README.md',
        sourceUrl: `https://github.com/example/repo/blob/${commitSha}/README.md`,
        sourceLine: 4,
        excerpt: 'npm run preview',
        command: 'npm run preview',
        script: 'preview',
        manifestPath: 'package.json',
      },
      whyItMatters: 'A newcomer following the README may be unable to run this command if it is expected to use the root package.json.',
      verificationSteps: [
        'Inspect the surrounding README instructions and confirm the expected working directory.',
        'Check repository-local CONTRIBUTING guidance before proposing a documentation change.',
        'Check whether monorepo or workspace structure changes which package.json is intended.',
        'Confirm the intended script with the maintainers; do not infer a replacement from this observation.',
      ],
      limitations: [
        'This is a possible outdated or mismatched README command, not a confirmed repository defect.',
        'Nearby prose or repository conventions may imply a different working directory or manifest.',
      ],
    }]);
    expect(result.coverage).toMatchObject({
      status: 'checked',
      supportedCommandsChecked: 1,
      commandsSkipped: 0,
      findingsProduced: 1,
      findingsOmitted: 0,
    });
  });

  it.each([
    ['npm run build', { build: 'vite build' }],
    ['npm run-script docs', { docs: 'typedoc' }],
    ['npm run preview -- --host 127.0.0.1', { preview: 'vite preview' }],
  ])('does not report the exactly defined script for %s', (command, scripts) => {
    const result = analyze(`\`\`\`shell\n${command}\n\`\`\``, scripts);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ status: 'checked', supportedCommandsChecked: 1, findingsProduced: 0 });
  });

  it.each(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'text', 'txt'])(
    'checks supported fenced %s blocks', (language) => {
      const result = analyze(`\`\`\`${language}\nnpm run missing\n\`\`\``);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].evidence.script).toBe('missing');
    },
  );

  it('ignores prose, inline code, indented code, and unsupported fenced languages', () => {
    const result = analyze([
      'Run npm run prose when ready.',
      '',
      '`npm run inline`',
      '',
      '    npm run indented',
      '',
      '```javascript',
      'npm run javascript',
      '```',
    ].join('\n'));

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedCommandsChecked: 0 });
    expect(result.coverage.skippedByReason.unsupportedBlock).toBe(2);
  });

  it.each([
    '# npm run commented',
    'npm run first && npm run second',
    'npm run first || npm run second',
    'npm run first | tee output.txt',
    'npm run first; npm run second',
    'npm run $(printf first)',
    'npm run `printf first`',
    'npm run first > output.txt',
    'npm run first # trailing shell comment',
    'NAME=first npm run first',
    '$ npm run prompted',
  ])('skips ambiguous shell input: %s', (command) => {
    const result = analyze(`\`\`\`bash\n${command}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedCommandsChecked: 0, commandsSkipped: 1 });
    expect(result.coverage.skippedByReason.ambiguousShell).toBe(1);
  });

  it.each([
    ['here-document', 'cat << EOF\nnpm run dev\nEOF'],
    ['line continuation', 'echo setup \\\nnpm run dev'],
    ['conditional body', 'if false; then\nnpm run dev\nfi'],
    ['multiline quote', 'echo "\nnpm run dev\n"'],
  ])('does not treat npm text inside a %s as a standalone command', (_label, body) => {
    const result = analyze(`\`\`\`bash\n${body}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.supportedCommandsChecked).toBe(0);
    expect(result.coverage.skippedByReason.ambiguousShell).toBeGreaterThanOrEqual(1);
  });

  it.each([
    'npm run preview --if-present',
    'npm run --if-present preview',
    'npm --if-present run preview',
    'npm run preview --if-present=true',
  ])('skips --if-present command: %s', (command) => {
    const result = analyze(`\`\`\`bash\n${command}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.ifPresent).toBe(1);
  });

  it.each([
    'npm run build --workspace app',
    'npm run build --workspace=app',
    'npm run build --workspaces',
    'npm run build -w app',
    'npm run build -w=app',
    'npm --workspace app run build',
    'npm -ws run build',
  ])('skips workspace-aware command: %s', (command) => {
    const result = analyze(`\`\`\`bash\n${command}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.workspace).toBe(1);
  });

  it.each([
    'npm run dev --prefix examples',
    'npm run dev -C examples',
    'npm run dev --ws',
    'npm run dev --if-pres',
    'npm run dev --color',
  ])('skips npm configuration flags before the script-argument delimiter: %s', (command) => {
    const result = analyze(`\`\`\`bash\n${command}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedCommandsChecked: 0, commandsSkipped: 1 });
  });

  it('allows ordinary script arguments after npm argument delimiter without interpreting them as npm flags', () => {
    const result = analyze('```bash\nnpm run dev -- --workspace demo --if-present --prefix examples\n```');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.script).toBe('dev');
    expect(result.coverage.supportedCommandsChecked).toBe(1);
  });

  it.each([
    'npm test',
    'npm start',
    'npm install',
    'yarn run preview',
    'pnpm run preview',
    'bun run preview',
  ])('does not analyze unsupported command: %s', (command) => {
    const result = analyze(`\`\`\`text\n${command}\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.unsupportedCommand).toBe(1);
  });

  it('skips root-manifest comparison after cd moves away from root', () => {
    const result = analyze('```bash\ncd examples\nnpm run dev\n```');

    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ supportedCommandsChecked: 0, commandsSkipped: 1 });
    expect(result.coverage.skippedByReason.nonRootWorkingDirectory).toBe(1);
  });

  it('skips subsequent comparison after working-directory state becomes uncertain', () => {
    const result = analyze('```bash\ncd "$EXAMPLE_DIR"\nnpm run dev\n```');

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.uncertainWorkingDirectory).toBe(1);
  });

  it.each(['pushd examples', 'popd'])('treats %s as uncertain working-directory state', (command) => {
    const result = analyze(`\`\`\`bash\n${command}\nnpm run dev\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.uncertainWorkingDirectory).toBe(1);
  });

  it('invalidates root context after a skipped compound command can change directory', () => {
    const result = analyze('```bash\necho setup && cd examples\nnpm run dev\n```');

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.uncertainWorkingDirectory).toBe(1);
  });

  it('resets working-directory state for each fenced code block', () => {
    const result = analyze([
      '```bash',
      'cd examples',
      'npm run dev',
      '```',
      '',
      '```bash',
      'npm run dev',
      '```',
    ].join('\n'));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence).toMatchObject({ script: 'dev', sourceLine: 7 });
    expect(result.coverage).toMatchObject({ supportedCommandsChecked: 1, commandsSkipped: 1 });
  });

  it('resumes comparison after a simple deterministic return to root', () => {
    const result = analyze('```bash\ncd examples/demo\ncd ../..\nnpm run dev\n```');

    expect(result.findings).toHaveLength(1);
    expect(result.coverage.supportedCommandsChecked).toBe(1);
  });

  it.each(['cd .', 'cd ./', 'cd examples/..'])('keeps simple root-equivalent %s context eligible', (changeDirectory) => {
    const result = analyze(`\`\`\`bash\n${changeDirectory}\nnpm run dev\n\`\`\``);

    expect(result.findings).toHaveLength(1);
  });

  it.each([
    'cd ..',
    'cd -',
    'cd /tmp',
    'cd ~/example',
    'cd examples && npm run dev',
  ])('treats uncertain directory change as preventing comparison: %s', (changeDirectory) => {
    const result = analyze(`\`\`\`bash\n${changeDirectory}\nnpm run dev\n\`\`\``);

    expect(result.findings).toEqual([]);
    expect(result.coverage.skippedByReason.uncertainWorkingDirectory).toBeGreaterThanOrEqual(1);
  });

  it('matches script names exactly and case-sensitively', () => {
    const result = analyze('```bash\nnpm run Build\n```', { build: 'vite build' });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.script).toBe('Build');
  });

  it('deduplicates by finding type, README source, and script while retaining first evidence', () => {
    const first = analyze('```bash\nnpm run preview\nnpm run-script preview -- --host\n```');
    const second = analyze('```bash\nnpm run preview\nnpm run-script preview -- --host\n```');

    expect(first.findings).toHaveLength(1);
    expect(first.findings[0].id).toBe(second.findings[0].id);
    expect(first.findings[0].evidence).toMatchObject({ sourceLine: 2, command: 'npm run preview', script: 'preview' });
    expect(first.coverage).toMatchObject({ supportedCommandsChecked: 2, findingsProduced: 1 });
  });

  it.each([
    ['README unavailable', {
      readme: { status: 'unavailable', message: 'No README.' },
      packageJson: { status: 'available', document: document('package.json', 'package-json', '{"scripts":{}}') },
    }, 'readme-unavailable'],
    ['package.json unavailable', {
      readme: { status: 'available', document: document('README.md', 'readme', '```bash\nnpm run dev\n```') },
      packageJson: { status: 'unavailable', message: 'No package.json.' },
    }, 'manifest-unavailable'],
  ] as const)('exposes a stable skipped status when %s', (_label, states, skipReason) => {
    const input = documents('', '{}');
    input.readme = states.readme;
    input.packageJson = states.packageJson;

    expect(analyzeReadmeNpmScripts({ documents: input })).toMatchObject({
      findings: [],
      coverage: { status: 'skipped', skipReason, supportedCommandsChecked: 0, findingsProduced: 0 },
    });
  });

  it.each([
    ['malformed JSON', '{', 'manifest-invalid-json'],
    ['top-level array', '[]', 'manifest-not-object'],
    ['top-level primitive', 'null', 'manifest-not-object'],
    ['missing scripts', '{}', 'scripts-missing'],
    ['null scripts', '{"scripts":null}', 'scripts-invalid'],
    ['array scripts', '{"scripts":[]}', 'scripts-invalid'],
    ['non-string script value', '{"scripts":{"build":42}}', 'scripts-invalid'],
  ])('skips comparison for %s', (_label, packageJsonText, skipReason) => {
    const result = analyzeReadmeNpmScripts({
      documents: documents('```bash\nnpm run preview\n```', packageJsonText),
    });

    expect(result).toMatchObject({
      findings: [],
      coverage: { status: 'skipped', skipReason, supportedCommandsChecked: 0, findingsProduced: 0 },
    });
  });

  it('bounds command evidence and finding output while counting omitted unique scripts', () => {
    const commands = Array.from({ length: 51 }, (_, index) =>
      `npm run missing-${index} -- ${'argument'.repeat(40)}`).join('\n');
    const result = analyze(`\`\`\`bash\n${commands}\n\`\`\``);

    expect(result.findings).toHaveLength(50);
    expect(result.findings[0].evidence.command.length).toBeLessThanOrEqual(240);
    expect(result.findings[0].evidence.excerpt.length).toBeLessThanOrEqual(240);
    expect(result.coverage).toMatchObject({
      supportedCommandsChecked: 51,
      findingsProduced: 50,
      findingsOmitted: 1,
    });
  });

  it('bounds displayed script evidence while retaining the full script for comparison and identity', () => {
    const script = `missing-${'x'.repeat(1_000)}`;
    const result = analyze(`\`\`\`bash\nnpm run ${script}\n\`\`\``);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence.script.length).toBeLessThanOrEqual(240);
    expect(result.findings[0].evidence.script).toMatch(/\.\.\.$/);
  });

  it.each([
    ['blockquote', '> ```bash\n> npm run dev\n> ```', 2],
    ['list item', '- ```bash\n  npm run dev\n  ```', 2],
  ])('analyzes a supported fenced block nested in a %s with the correct source line', (_label, markdown, sourceLine) => {
    const result = analyze(markdown);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].evidence).toMatchObject({ script: 'dev', sourceLine });
  });

  it('skips a link-dense README before synchronous Markdown parsing', () => {
    const markdown = Array.from({ length: 1_001 }, () => '[x](a)').join(' ');
    const result = analyzeReadmeNpmScripts({ documents: documents(markdown, '{"scripts":{}}') });

    expect(result).toMatchObject({
      findings: [],
      coverage: {
        status: 'skipped',
        skipReason: 'parser-safety-limit',
        supportedCommandsChecked: 0,
        findingsProduced: 0,
      },
    });
  });
});
