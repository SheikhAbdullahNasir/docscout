import type {
  PublicRepositoryMetadata, RepositoryDocument, RepositoryDocuments, RepositoryDocumentSkip,
  RepositoryDocumentState, RepositoryTreeEntry,
  ScanResourceWarningCode,
} from '@docscout/shared';

export const MAX_DOCUMENT_BYTES = 256 * 1024;

export type DocumentCategory = 'readme' | 'contributing' | 'package-json' | 'docs';

export type DocumentCandidate = RepositoryTreeEntry & {
  category: DocumentCategory;
  type: 'blob';
  mode: '100644' | '100755';
};

export type DocumentObjectSkip = {
  path: string;
  category: DocumentCategory;
  reason: 'symlink' | 'submodule';
};

export type DocumentCandidates = {
  readme?: DocumentCandidate;
  contributing?: DocumentCandidate;
  packageJson?: DocumentCandidate;
  docs: DocumentCandidate[];
  skipped: DocumentObjectSkip[];
  docsOmitted: boolean;
};

export type DecodedContentsFile =
  | { status: 'available'; text: string; decodedSize: number; reportedSize: number }
  | { status: 'skipped'; reason: 'malformed' | 'oversized' | 'binary' | 'git-lfs-pointer' };

export type ContentsLoaderResult = { status: 'available'; value: unknown }
  | { status: 'unavailable'; reason?: ScanResourceWarningCode; message?: string };

const markdownReadmeExtensions = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd']);

function comparePath(left: { path: string }, right: { path: string }): number {
  const foldedLeft = left.path.toLowerCase();
  const foldedRight = right.path.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function decodeBase64(value: string): Buffer | undefined {
  const compact = value.replace(/[\t\n\r ]/g, '');
  if (compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) return undefined;
  return Buffer.from(compact, 'base64');
}

function binaryText(text: string): boolean {
  if (text.includes('\0')) return true;
  let controls = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) || code === 127) controls += 1;
  }
  return controls > Math.max(1, Math.floor(text.length / 100));
}

export function decodeContentsFile(value: unknown, candidate: DocumentCandidate): DecodedContentsFile {
  const data = object(value);
  if (!data || data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string'
    || data.path !== candidate.path || data.sha !== candidate.sha || typeof data.size !== 'number'
    || !Number.isSafeInteger(data.size) || data.size < 0) return { status: 'skipped', reason: 'malformed' };
  if (data.size > MAX_DOCUMENT_BYTES) return { status: 'skipped', reason: 'oversized' };
  const bytes = decodeBase64(data.content);
  if (!bytes || bytes.byteLength !== data.size) return { status: 'skipped', reason: 'malformed' };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { status: 'skipped', reason: 'oversized' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { status: 'skipped', reason: 'binary' };
  }
  if (binaryText(text)) return { status: 'skipped', reason: 'binary' };
  if (/^version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/.test(text)) {
    return { status: 'skipped', reason: 'git-lfs-pointer' };
  }
  return { status: 'available', text, decodedSize: bytes.byteLength, reportedSize: data.size };
}

function readmeCandidate(path: string): boolean {
  if (path.includes('/')) return false;
  const match = /^readme\.([^.]+)$/i.exec(path);
  return match !== null && markdownReadmeExtensions.has(match[1].toLowerCase());
}

function contributionRank(path: string): number | undefined {
  const parts = path.split('/');
  if (parts.length === 1 && /^contributing\.md$/i.test(parts[0])) return 0;
  if (parts.length === 2 && parts[0] === '.github' && /^contributing\.md$/i.test(parts[1])) return 1;
  if (parts.length === 2 && parts[0] === 'docs' && /^contributing\.md$/i.test(parts[1])) return 2;
  return undefined;
}

function categoryForPath(path: string): DocumentCategory | undefined {
  if (readmeCandidate(path)) return 'readme';
  if (contributionRank(path) !== undefined) return 'contributing';
  if (path === 'package.json') return 'package-json';
  if (path.startsWith('docs/') && /\.md$/i.test(path)) return 'docs';
  return undefined;
}

function regularCandidate(entry: RepositoryTreeEntry, category: DocumentCategory): DocumentCandidate | undefined {
  if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) return undefined;
  return {
    path: entry.path, type: entry.type, mode: entry.mode, sha: entry.sha,
    ...(entry.size === undefined ? {} : { size: entry.size }), category,
  };
}

export function selectDocumentCandidates(entries: RepositoryTreeEntry[]): DocumentCandidates {
  const candidates: DocumentCandidate[] = [];
  const skipped: DocumentObjectSkip[] = [];
  for (const entry of entries) {
    const category = categoryForPath(entry.path);
    if (!category) continue;
    const candidate = regularCandidate(entry, category);
    if (candidate) candidates.push(candidate);
    else if (entry.type === 'commit' || entry.mode === '160000') {
      skipped.push({ path: entry.path, category, reason: 'submodule' });
    } else if (entry.type === 'blob' && entry.mode === '120000') {
      skipped.push({ path: entry.path, category, reason: 'symlink' });
    }
  }

  const readmes = candidates.filter(({ category }) => category === 'readme').sort(comparePath);
  const exactReadme = readmes.find(({ path }) => path === 'README.md');
  const contributions = candidates.filter(({ category }) => category === 'contributing')
    .sort((left, right) => (contributionRank(left.path) ?? 3) - (contributionRank(right.path) ?? 3)
      || comparePath(left, right));
  const packageJson = candidates.find(({ category }) => category === 'package-json');
  const contribution = contributions[0];
  const additionalDocs = candidates.filter(({ category, path }) => category === 'docs'
    && path !== contribution?.path).sort(comparePath);

  return {
    ...(exactReadme ?? readmes[0] ? { readme: exactReadme ?? readmes[0] } : {}),
    ...(contribution ? { contributing: contribution } : {}),
    ...(packageJson ? { packageJson } : {}),
    docs: additionalDocs.slice(0, 12),
    skipped: skipped.sort(comparePath),
    docsOmitted: additionalDocs.length > 12,
  };
}

const missing = {
  readme: 'No supported root Markdown README found.',
  contributing: 'Repository-local contribution guidance is unavailable.',
  packageJson: 'No root package.json was found.',
} as const;

const incomplete = {
  readme: 'README availability is unknown because tree path coverage is incomplete.',
  contributing: 'Repository-local contribution guidance availability is unknown because tree path coverage is incomplete.',
  packageJson: 'Root package.json availability is unknown because tree path coverage is incomplete.',
} as const;

function initialState(kind: keyof typeof missing, complete: boolean): RepositoryDocumentState {
  return complete
    ? { status: 'unavailable', message: missing[kind] }
    : { status: 'unknown', message: incomplete[kind] };
}

function sourceUrl(repository: PublicRepositoryMetadata, commitSha: string, path: string): string {
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/blob/${encodeURIComponent(commitSha)}/${encodedPath}`;
}

function unavailableState(category: Exclude<DocumentCategory, 'docs'>): RepositoryDocumentState {
  const label = category === 'readme' ? 'README' : category === 'contributing' ? 'contribution guidance' : 'root package.json';
  return { status: 'unavailable', message: `The selected ${label} could not be read safely at the pinned commit.` };
}

export async function retrieveDocuments(
  repository: PublicRepositoryMetadata,
  commitSha: string,
  tree: { entries: RepositoryTreeEntry[]; complete: boolean },
  load: (candidate: DocumentCandidate) => Promise<ContentsLoaderResult>,
): Promise<RepositoryDocuments> {
  const candidates = selectDocumentCandidates(tree.entries);
  const skipped: RepositoryDocumentSkip[] = [...candidates.skipped];
  const documents: RepositoryDocuments = {
    selectionComplete: tree.complete,
    readme: initialState('readme', tree.complete),
    contributing: initialState('contributing', tree.complete),
    packageJson: initialState('packageJson', tree.complete),
    docs: [], skipped,
    omissions: candidates.docsOmitted ? ['docs-limit'] : [],
  };
  const ordered = [candidates.readme, candidates.contributing, candidates.packageJson, ...candidates.docs]
    .filter((candidate): candidate is DocumentCandidate => candidate !== undefined);
  let combinedSize = 0;
  let combinedLimitReached = false;

  for (const candidate of ordered) {
    if (combinedSize >= 2 * 1024 * 1024 && !combinedLimitReached) {
      combinedLimitReached = true;
      documents.omissions.push('combined-content-limit');
    }
    if (combinedLimitReached) {
      skipped.push({ path: candidate.path, category: candidate.category, reason: 'combined-content-limit' });
      continue;
    }
    if (candidate.size !== undefined && candidate.size > MAX_DOCUMENT_BYTES) {
      skipped.push({ path: candidate.path, category: candidate.category, reason: 'oversized' });
      if (candidate.category !== 'docs') documents[candidate.category === 'package-json' ? 'packageJson' : candidate.category] = unavailableState(candidate.category);
      continue;
    }
    if (candidate.size !== undefined && combinedSize + candidate.size > 2 * 1024 * 1024) {
      combinedLimitReached = true;
      documents.omissions.push('combined-content-limit');
      skipped.push({ path: candidate.path, category: candidate.category, reason: 'combined-content-limit' });
      continue;
    }

    const loaded = await load(candidate);
    if (loaded.status === 'unavailable') {
      skipped.push({ path: candidate.path, category: candidate.category, reason: loaded.reason ?? 'unavailable' });
      if (loaded.reason && !documents.omissions.includes(loaded.reason)) documents.omissions.push(loaded.reason);
      if (candidate.category !== 'docs') {
        documents[candidate.category === 'package-json' ? 'packageJson' : candidate.category] = loaded.reason
          ? { status: 'unknown', message: loaded.message ?? 'Selected content was not checked because a scan resource limit was reached.' }
          : unavailableState(candidate.category);
      }
      continue;
    }
    const decoded = decodeContentsFile(loaded.value, candidate);
    if (decoded.status === 'skipped') {
      skipped.push({ path: candidate.path, category: candidate.category, reason: decoded.reason });
      if (candidate.category !== 'docs') documents[candidate.category === 'package-json' ? 'packageJson' : candidate.category] = unavailableState(candidate.category);
      continue;
    }
    if (combinedSize + decoded.decodedSize > 2 * 1024 * 1024) {
      combinedLimitReached = true;
      documents.omissions.push('combined-content-limit');
      skipped.push({ path: candidate.path, category: candidate.category, reason: 'combined-content-limit' });
      continue;
    }
    combinedSize += decoded.decodedSize;
    const document: RepositoryDocument = {
      path: candidate.path, category: candidate.category,
      sourceUrl: sourceUrl(repository, commitSha, candidate.path), text: decoded.text,
      sha: candidate.sha, decodedSize: decoded.decodedSize, reportedSize: decoded.reportedSize,
    };
    if (candidate.category === 'docs') documents.docs.push(document);
    else documents[candidate.category === 'package-json' ? 'packageJson' : candidate.category] = { status: 'available', document };
  }

  return documents;
}
