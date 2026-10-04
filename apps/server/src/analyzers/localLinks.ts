import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type {
  MissingLocalTargetFinding,
  RepositoryDocuments,
  RepositoryMarkdownLinkAnalysis,
  RepositoryTreeEntry,
} from '@docscout/shared';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

type Position = {
  start: { line: number; offset?: number };
  end: { line: number; offset?: number };
};

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  identifier?: string;
  alt?: string | null;
  position?: Position;
};

type AnalyzerInput = {
  documents: RepositoryDocuments;
  tree: { entries: RepositoryTreeEntry[]; truncated: boolean; complete: boolean };
};

type UnsupportedReason = keyof RepositoryMarkdownLinkAnalysis['coverage']['unsupportedByReason'];

type Destination =
  | { status: 'supported'; normalizedTarget: string; removedFragment: boolean; removedQuery: boolean }
  | { status: 'unsupported'; reason: UnsupportedReason };

const LIMITATIONS = [
  'Image targets are unsupported and are not checked.',
  'External URLs, protocol-relative URLs, mail links, pure anchors, other URI schemes, unresolved references, and suspicious encodings are not checked.',
  'Query strings are removed before repository-path lookup; application or router query behavior is not interpreted.',
  'Fragments are removed before repository-path lookup; heading anchors are not verified.',
  'Missing-target findings require a complete recursive repository tree.',
  'Documentation findings are limited to the first 50 deterministic observations; additional unique observations are counted as omitted.',
  'A selected document with more than 1,000 potential link openers is left unchecked to keep untrusted Markdown parsing bounded.',
];

const MAX_FINDINGS = 50;
const MAX_LINK_OPENERS_PER_DOCUMENT = 1_000;

function referenceKey(identifier: string): string {
  return identifier.trim().replace(/\s+/g, ' ').toLowerCase();
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
}

function countUnresolvedExplicitReferences(
  root: MarkdownNode,
  source: string,
  coverage: RepositoryMarkdownLinkAnalysis['coverage'],
): void {
  const blockedTypes = new Set(['code', 'inlineCode', 'html', 'definition', 'link', 'linkReference', 'image', 'imageReference']);
  const blocked: Array<{ start: number; end: number }> = [];
  walk(root, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (blockedTypes.has(node.type) && typeof start === 'number' && typeof end === 'number') blocked.push({ start, end });
  });
  blocked.sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedBlocked: Array<{ start: number; end: number }> = [];
  for (const range of blocked) {
    const previous = mergedBlocked.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else mergedBlocked.push({ ...range });
  }
  // CommonMark intentionally leaves undefined full/collapsed references as source text.
  // AST ranges keep this narrow fallback out of code, definitions, and parsed links.
  // Escaped brackets keep the reference grammar readable inside the negated classes.
  // eslint-disable-next-line no-useless-escape
  const references = source.matchAll(/(!?)\[(?:\\.|[^\[\]\\\r\n])+\]\[(?:\\.|[^\[\]\\\r\n])*\]/g);
  let blockedIndex = 0;
  for (const match of references) {
    const start = match.index;
    const end = start + match[0].length;
    let precedingBackslashes = 0;
    for (let index = start - 1; index >= 0 && source[index] === '\\'; index -= 1) precedingBackslashes += 1;
    if (precedingBackslashes % 2 === 1) continue;
    while (blockedIndex < mergedBlocked.length && mergedBlocked[blockedIndex].end <= start) blockedIndex += 1;
    const range = mergedBlocked[blockedIndex];
    if (range && start < range.end && end > range.start) continue;
    if (match[1] === '!') {
      coverage.unsupportedLinks += 1;
      coverage.unsupportedByReason.images += 1;
    } else {
      coverage.uncheckedLinks += 1;
      coverage.uncheckedByReason.unresolvedReference += 1;
    }
  }
}

function linkText(node: MarkdownNode): string {
  const values: string[] = [];
  walk(node, (child) => {
    if ((child.type === 'text' || child.type === 'inlineCode') && typeof child.value === 'string') values.push(child.value);
    else if (child.type === 'image' && typeof child.alt === 'string') values.push(child.alt);
  });
  return values.join('').trim();
}

function excerpt(text: string, line: number): string {
  const value = text.split(/\r\n|\n|\r/, line)[line - 1]?.trim() ?? '';
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

function boundedEvidence(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

function exceedsParserSafetyLimit(text: string): boolean {
  let openers = 0;
  for (const character of text) {
    if (character === '[' && (openers += 1) > MAX_LINK_OPENERS_PER_DOCUMENT) return true;
  }
  return false;
}

function unsupported(reason: UnsupportedReason): Destination {
  return { status: 'unsupported', reason };
}

function normalizeDestination(rawTarget: string, sourcePath: string): Destination {
  if (rawTarget.startsWith('//')) return unsupported('protocolRelative');
  if (/^https?:\/\//i.test(rawTarget)) return unsupported('external');
  if (/^mailto:/i.test(rawTarget)) return unsupported('mailto');
  if (rawTarget.startsWith('#')) return unsupported('pureAnchor');
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawTarget)) return unsupported('otherScheme');
  const queryIndex = rawTarget.indexOf('?');
  const fragmentIndex = rawTarget.indexOf('#');
  const cutIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const pathPart = cutIndexes.length > 0 ? rawTarget.slice(0, Math.min(...cutIndexes)) : rawTarget;
  if (pathPart.includes('\0') || pathPart.includes('\\') || /%(?:2f|5c)/i.test(pathPart)) {
    return unsupported('suspiciousTarget');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return unsupported('suspiciousTarget');
  }
  if (decoded.includes('\\') || /%(?:2f|5c)/i.test(decoded)
    || [...decoded].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return unsupported('suspiciousTarget');
  }
  if (decoded.startsWith('//')) return unsupported('protocolRelative');
  if (/^https?:\/\//i.test(decoded)) return unsupported('external');
  if (/^mailto:/i.test(decoded)) return unsupported('mailto');
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return unsupported('otherScheme');

  const segments = decoded.startsWith('/') ? [] : posix.dirname(sourcePath).split('/').filter((part) => part !== '.');
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return unsupported('suspiciousTarget');
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return {
    status: 'supported',
    normalizedTarget: segments.join('/'),
    removedFragment: fragmentIndex >= 0,
    removedQuery: queryIndex >= 0,
  };
}

function findingId(sourcePath: string, normalizedTarget: string): string {
  const key = `missing-local-target\0${sourcePath}\0${normalizedTarget}`;
  return `missing-local-target:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function finding(
  document: { path: string; sourceUrl: string; text: string },
  node: MarkdownNode,
  rawTarget: string,
  normalizedTarget: string,
): MissingLocalTargetFinding {
  const sourceLine = node.position?.start.line ?? 1;
  return {
    id: findingId(document.path, normalizedTarget),
    type: 'missing-local-target',
    title: 'Repository-relative target is absent from the scanned snapshot',
    observation: 'Target is absent from the scanned repository snapshot.',
    confidence: 'high',
    difficulty: 'unknown',
    evidence: {
      sourceDocumentPath: document.path,
      sourceUrl: document.sourceUrl,
      sourceLine,
      excerpt: excerpt(document.text, sourceLine),
      linkText: boundedEvidence(linkText(node)),
      originalTarget: boundedEvidence(rawTarget),
      normalizedTarget,
    },
    whyItMatters: 'A contributor following this link may be unable to open the referenced repository documentation in the scanned snapshot.',
    verificationSteps: [
      'Verify whether the target represents generated documentation, a site/router path, build-time documentation behavior, or another intentional project convention.',
      'Inspect the pinned source and the repository documentation configuration before proposing a change.',
    ],
    limitations: [
      'Snapshot absence does not establish that the documentation is broken, identify the correct replacement target, or show that the maintainer wants a contribution.',
    ],
  };
}

export function analyzeRepositoryMarkdownTargets(input: AnalyzerInput): RepositoryMarkdownLinkAnalysis {
  const coverage: RepositoryMarkdownLinkAnalysis['coverage'] = {
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
      images: 0,
      external: 0,
      protocolRelative: 0,
      mailto: 0,
      pureAnchor: 0,
      otherScheme: 0,
      suspiciousTarget: 0,
    },
    limitations: [...LIMITATIONS],
  };
  const findings = new Map<string, MissingLocalTargetFinding>();
  const missingKeys = new Set<string>();
  const paths = new Set(input.tree.entries.map(({ path }) => path));
  const selectedDocuments = [
    ...(input.documents.readme.status === 'available' ? [input.documents.readme.document] : []),
    ...(input.documents.contributing.status === 'available' ? [input.documents.contributing.document] : []),
    ...input.documents.docs,
  ];

  for (const document of selectedDocuments) {
    if (exceedsParserSafetyLimit(document.text)) {
      coverage.documentsUnchecked += 1;
      coverage.uncheckedDocumentsByReason.parserSafetyLimit += 1;
      continue;
    }
    coverage.documentsAnalyzed += 1;
    const root = unified().use(remarkParse).parse(document.text) as MarkdownNode;
    const definitions = new Map<string, string>();
    walk(root, (node) => {
      if (node.type === 'definition' && typeof node.identifier === 'string' && typeof node.url === 'string') {
        const key = referenceKey(node.identifier);
        if (!definitions.has(key)) definitions.set(key, node.url);
      }
    });
    countUnresolvedExplicitReferences(root, document.text, coverage);

    walk(root, (node) => {
      if (node.type === 'image' || node.type === 'imageReference') {
        coverage.unsupportedLinks += 1;
        coverage.unsupportedByReason.images += 1;
        return;
      }
      let rawTarget: string | undefined;
      if (node.type === 'link' && typeof node.url === 'string') rawTarget = node.url;
      else if (node.type === 'linkReference' && typeof node.identifier === 'string') {
        rawTarget = definitions.get(referenceKey(node.identifier));
        if (rawTarget === undefined) {
          coverage.uncheckedLinks += 1;
          coverage.uncheckedByReason.unresolvedReference += 1;
          return;
        }
      } else return;

      const destination = normalizeDestination(rawTarget, document.path);
      if (destination.status === 'unsupported') {
        coverage.unsupportedLinks += 1;
        coverage.unsupportedByReason[destination.reason] += 1;
        return;
      }
      let linkUnchecked = false;
      if (destination.removedFragment) {
        coverage.uncheckedByReason.fragmentAnchor += 1;
        linkUnchecked = true;
      }
      const targetExists = destination.normalizedTarget === '' || paths.has(destination.normalizedTarget);
      if (input.tree.complete || targetExists) coverage.supportedLinksChecked += 1;
      else {
        coverage.uncheckedByReason.incompleteTree += 1;
        linkUnchecked = true;
      }
      if (linkUnchecked) coverage.uncheckedLinks += 1;
      if (targetExists || !input.tree.complete) return;
      const key = `missing-local-target\0${document.path}\0${destination.normalizedTarget}`;
      if (missingKeys.has(key)) return;
      missingKeys.add(key);
      if (findings.size < MAX_FINDINGS) findings.set(key, finding(document, node, rawTarget, destination.normalizedTarget));
    });
  }

  coverage.findingsProduced = findings.size;
  coverage.findingsOmitted = missingKeys.size - findings.size;
  return { findings: [...findings.values()], coverage };
}
