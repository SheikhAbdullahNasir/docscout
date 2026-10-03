import type { RepositoryTreeEntry } from '@docscout/shared';
import { ApplicationError } from '../errors.js';

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

export function validBranch(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value !== '@'
    && !value.includes('..') && !value.includes('@{') && !/[ ~^:?*[\\]/.test(value)
    && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && value.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}

export function commitSnapshot(value: unknown): { commitSha: string; treeSha: string } {
  const data = object(value);
  const treeSha = object(object(data?.commit)?.tree)?.sha;
  if (!validSha(data?.sha) || !validSha(treeSha)) {
    throw new ApplicationError(502, 'COMMIT_LOOKUP_FAILED', 'GitHub returned invalid commit snapshot data. Please retry later.');
  }
  return { commitSha: data.sha, treeSha };
}

export function recursiveTree(value: unknown, expectedSha: string) {
  const invalid = () => new ApplicationError(502, 'TREE_LOOKUP_FAILED', 'GitHub returned invalid repository tree data. Path coverage is unavailable.');
  const data = object(value);
  if (data?.sha !== expectedSha || typeof data.truncated !== 'boolean' || !Array.isArray(data.tree) || data.tree.length > 100_000) throw invalid();
  const paths = new Set<string>();
  const entries: RepositoryTreeEntry[] = data.tree.map((value: unknown) => {
    const entry = object(value);
    const path = entry?.path;
    if (typeof path !== 'string' || path.length === 0 || path.includes('\\')
      || [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || path.split('/').some((part) => part === '' || part === '.' || part === '..')
      || paths.has(path) || !validSha(entry?.sha)) throw invalid();
    paths.add(path);
    const { type, mode, sha, size } = entry;
    if (!((type === 'blob' && (mode === '100644' || mode === '100755' || mode === '120000'))
      || (type === 'tree' && mode === '040000') || (type === 'commit' && mode === '160000'))
      || (size !== undefined && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0))) throw invalid();
    // Do not retain or request entry.url, content, or any other response field.
    return { path, type, mode, sha, ...(size === undefined ? {} : { size }) } as RepositoryTreeEntry;
  });
  return { entries, truncated: data.truncated, complete: !data.truncated };
}
