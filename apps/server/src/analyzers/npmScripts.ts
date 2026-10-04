import { createHash } from 'node:crypto';
import type {
  PossibleMissingNpmScriptFinding,
  RepositoryDocuments,
  RepositoryNpmScriptAnalysis,
} from '@docscout/shared';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

type MarkdownNode = {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { line: number } };
};

type AnalyzerInput = { documents: RepositoryDocuments };
type Coverage = RepositoryNpmScriptAnalysis['coverage'];
type SkipReason = NonNullable<Coverage['skipReason']>;
type WorkingDirectory = { status: 'known'; segments: string[] } | { status: 'uncertain' };

const MAX_FINDINGS = 50;
const MAX_EVIDENCE_LENGTH = 240;
const SUPPORTED_BLOCK_LANGUAGES = new Set([
  'bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'text', 'txt',
]);
const WORKSPACE_FLAGS = new Set([
  '-w', '-ws', '--workspace', '--workspaces', '--include-workspace-root',
]);
const LIMITATIONS = [
  'Only conservative standalone npm run NAME and npm run-script NAME commands in supported README fenced code blocks are checked.',
  'npm test, npm start, other package managers, shell expressions, --if-present, and workspace-aware invocations are not analyzed.',
  'Only the root package.json scripts object is used; nested and workspace manifests are not resolved.',
  'Working-directory tracking supports only simple deterministic relative cd paths and resets for each code block.',
  'Nearby prose can imply another directory, so every missing-script observation requires manual review.',
  'Findings are limited to the first 50 unique type, README source, and script combinations; additional observations are counted as omitted.',
];

function initialCoverage(): Coverage {
  return {
    status: 'checked',
    supportedCommandsChecked: 0,
    commandsSkipped: 0,
    findingsProduced: 0,
    findingsOmitted: 0,
    skippedByReason: {
      unsupportedBlock: 0,
      unsupportedCommand: 0,
      ambiguousShell: 0,
      ifPresent: 0,
      workspace: 0,
      nonRootWorkingDirectory: 0,
      uncertainWorkingDirectory: 0,
    },
    limitations: [...LIMITATIONS],
  };
}

function skipped(coverage: Coverage, skipReason: SkipReason): RepositoryNpmScriptAnalysis {
  coverage.status = 'skipped';
  coverage.skipReason = skipReason;
  return { findings: [], coverage };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function scriptsFromManifest(text: string): { scripts: Record<string, string> } | { skipReason: SkipReason } {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { skipReason: 'manifest-invalid-json' };
  }
  const manifest = record(value);
  if (!manifest) return { skipReason: 'manifest-not-object' };
  if (!Object.hasOwn(manifest, 'scripts')) return { skipReason: 'scripts-missing' };
  const scripts = record(manifest.scripts);
  if (!scripts || Object.values(scripts).some((command) => typeof command !== 'string')) {
    return { skipReason: 'scripts-invalid' };
  }
  return { scripts: scripts as Record<string, string> };
}

function bounded(value: string): string {
  return value.length <= MAX_EVIDENCE_LENGTH ? value : `${value.slice(0, MAX_EVIDENCE_LENGTH - 3)}...`;
}

function findingId(sourcePath: string, script: string): string {
  return `possible-missing-npm-script:${createHash('sha256')
    .update(`possible-missing-npm-script\0${sourcePath}\0${script}`).digest('hex').slice(0, 16)}`;
}

function finding(
  readme: { path: string; sourceUrl: string },
  sourceLine: number,
  command: string,
  script: string,
): PossibleMissingNpmScriptFinding {
  const evidence = bounded(command);
  return {
    id: findingId(readme.path, script),
    type: 'possible-missing-npm-script',
    title: 'README npm script may not match the root package.json',
    confidence: 'needs-review',
    difficulty: 'unknown',
    evidence: {
      sourceDocumentPath: readme.path,
      sourceUrl: readme.sourceUrl,
      sourceLine,
      excerpt: evidence,
      command: evidence,
      script,
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
  };
}

function walk(root: MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    result.push(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return result;
}

function fencedCodeBlock(node: MarkdownNode, sourceLines: string[]): boolean {
  const openingLine = sourceLines[(node.position?.start.line ?? 1) - 1]?.trimStart() ?? '';
  return /^(`{3,}|~{3,})/.test(openingLine);
}

function ambiguousShell(line: string): boolean {
  return /(^|\s)#/.test(line) || line.startsWith('$ ') || /[;&|<>`]/.test(line)
    || line.includes('$(') || /(^|\s)[A-Za-z_][A-Za-z0-9_]*=.*\bnpm\s/.test(line)
    || /["'\\]/.test(line) || /\$(?:[A-Za-z_{]|$)/.test(line);
}

function workspaceAware(tokens: string[]): boolean {
  return tokens.some((token) => WORKSPACE_FLAGS.has(token)
    || token.startsWith('-w=') || token.startsWith('-ws=')
    || token.startsWith('--workspace=') || token.startsWith('--workspaces=')
    || token.startsWith('--include-workspace-root='));
}

function changeDirectory(current: WorkingDirectory, line: string): WorkingDirectory {
  if (current.status === 'uncertain') return current;
  const match = /^cd\s+(\S+)$/.exec(line);
  if (!match || match[1] === '-' || match[1].startsWith('/') || match[1].startsWith('~')
    || match[1].includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(match[1])) return { status: 'uncertain' };
  const segments = [...current.segments];
  for (const segment of match[1].split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return { status: 'uncertain' };
      segments.pop();
    } else segments.push(segment);
  }
  return { status: 'known', segments };
}

function skipCommand(coverage: Coverage, reason: keyof Coverage['skippedByReason']): void {
  coverage.commandsSkipped += 1;
  coverage.skippedByReason[reason] += 1;
}

export function analyzeReadmeNpmScripts({ documents }: AnalyzerInput): RepositoryNpmScriptAnalysis {
  const coverage = initialCoverage();
  if (documents.readme.status !== 'available') return skipped(coverage, 'readme-unavailable');
  if (documents.packageJson.status !== 'available') return skipped(coverage, 'manifest-unavailable');
  const manifest = scriptsFromManifest(documents.packageJson.document.text);
  if ('skipReason' in manifest) return skipped(coverage, manifest.skipReason);

  const readme = documents.readme.document;
  const sourceLines = readme.text.split(/\r\n|\n|\r/);
  const root = unified().use(remarkParse).parse(readme.text) as MarkdownNode;
  const findings = new Map<string, PossibleMissingNpmScriptFinding>();
  const missingKeys = new Set<string>();

  for (const node of walk(root)) {
    if (node.type !== 'code' || typeof node.value !== 'string') continue;
    const language = node.lang?.toLowerCase() ?? '';
    if (!fencedCodeBlock(node, sourceLines) || !SUPPORTED_BLOCK_LANGUAGES.has(language)) {
      coverage.skippedByReason.unsupportedBlock += 1;
      continue;
    }
    let workingDirectory: WorkingDirectory = { status: 'known', segments: [] };
    const contentStartLine = (node.position?.start.line ?? 1) + 1;
    for (const [lineIndex, rawLine] of node.value.split(/\r\n|\n|\r/).entries()) {
      const command = rawLine.trim();
      if (command === '') continue;
      if (/^(?:pushd|popd)(?:\s|$)/.test(command)) {
        skipCommand(coverage, 'ambiguousShell');
        workingDirectory = { status: 'uncertain' };
        continue;
      }
      if (/^cd(?:\s|$)/.test(command)) {
        if (ambiguousShell(command)) {
          skipCommand(coverage, 'ambiguousShell');
          workingDirectory = { status: 'uncertain' };
        } else workingDirectory = changeDirectory(workingDirectory, command);
        continue;
      }
      const tokens = command.split(/\s+/);
      if (tokens.some((token) => token === '--if-present' || token.startsWith('--if-present='))) {
        skipCommand(coverage, 'ifPresent');
        continue;
      }
      if (workspaceAware(tokens)) {
        skipCommand(coverage, 'workspace');
        continue;
      }
      if (ambiguousShell(command)) {
        skipCommand(coverage, 'ambiguousShell');
        continue;
      }
      const supported = tokens[0] === 'npm' && (tokens[1] === 'run' || tokens[1] === 'run-script')
        && tokens.length >= 3 && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(tokens[2]);
      if (!supported) {
        skipCommand(coverage, 'unsupportedCommand');
        continue;
      }
      if (workingDirectory.status === 'uncertain') {
        skipCommand(coverage, 'uncertainWorkingDirectory');
        continue;
      }
      if (workingDirectory.segments.length > 0) {
        skipCommand(coverage, 'nonRootWorkingDirectory');
        continue;
      }
      coverage.supportedCommandsChecked += 1;
      const script = tokens[2];
      if (Object.hasOwn(manifest.scripts, script)) continue;
      const key = `possible-missing-npm-script\0${readme.path}\0${script}`;
      if (missingKeys.has(key)) continue;
      missingKeys.add(key);
      if (findings.size < MAX_FINDINGS) {
        findings.set(key, finding(readme, contentStartLine + lineIndex, command, script));
      }
    }
  }

  coverage.findingsProduced = findings.size;
  coverage.findingsOmitted = missingKeys.size - findings.size;
  return { findings: [...findings.values()], coverage };
}
