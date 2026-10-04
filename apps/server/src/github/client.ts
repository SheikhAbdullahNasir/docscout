import type { PublicRepositoryMetadata, RepositorySnapshotResult } from '@docscout/shared';
import { ApplicationError } from '../errors.js';
import { analyzeRepositoryMarkdownTargets } from '../analyzers/localLinks.js';
import { validOwner, validRepo, type ValidatedRepository } from '../security/repositoryUrl.js';
import { retrieveDocuments, type DocumentCandidate } from './documents.js';
import { retrieveIssues } from './issues.js';
import { commitSnapshot, recursiveTree, validBranch } from './snapshot.js';

const API_BASE = 'https://api.github.com';
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const EMPTY_REPOSITORY = Symbol('empty-repository');
const CONTENT_UNAVAILABLE = Symbol('content-unavailable');

function upstreamError(message = 'GitHub returned an unavailable or invalid response. Please try again later.') {
  return new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', message);
}

async function boundedJson(response: Response, limit = RESPONSE_LIMIT): Promise<unknown> {
  if (!response.body) throw upstreamError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw upstreamError();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function publicMetadata(value: unknown): PublicRepositoryMetadata {
  const data = record(value);
  if (data?.private === true) {
    throw new ApplicationError(404, 'PRIVATE_REPOSITORY', 'Only public GitHub repositories are supported.');
  }
  const owner = record(data?.owner)?.login;
  const name = data?.name;
  const branch = data?.default_branch;
  if (!data || data.private !== false || !validOwner(owner) || !validRepo(name)
    || typeof data.archived !== 'boolean' || typeof branch !== 'string'
    || branch.length === 0 || branch.length > 255
    || [...branch].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw upstreamError();
  }
  const url = `https://github.com/${owner}/${name}`;
  if (data.html_url !== url) throw upstreamError();
  return { owner, name, url, private: false, archived: data.archived, defaultBranch: branch };
}

function retryTime(headers: Headers): string | undefined {
  const retry = headers.get('retry-after');
  const reset = headers.get('x-ratelimit-reset');
  const candidates: number[] = [];
  if (retry && /^\d+$/.test(retry)) candidates.push(Date.now() + Number(retry) * 1000);
  else if (retry) candidates.push(Date.parse(retry));
  if (reset && /^\d+$/.test(reset)) candidates.push(Number(reset) * 1000);
  const times = candidates.filter((time) => Number.isFinite(time) && time >= Date.now() && time <= 8.64e15);
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

export class GitHubClient {
  private readonly fetcher: typeof fetch;
  private readonly token?: string;
  private readonly now: () => Date;

  constructor(options: { fetcher?: typeof fetch; token?: string; now?: () => Date } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.token = options.token?.trim() || undefined;
    this.now = options.now ?? (() => new Date());
  }

  async getRepository(repository: ValidatedRepository): Promise<PublicRepositoryMetadata> {
    // Defense in depth for runtime callers; never construct a path from unchecked segments.
    if (!validOwner(repository.owner) || !validRepo(repository.repo)) {
      throw new ApplicationError(400, 'INVALID_REPOSITORY_URL', 'Enter https://github.com/owner/repo.');
    }
    return publicMetadata(await this.requestJson(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`));
  }

  async getSnapshot(metadata: PublicRepositoryMetadata): Promise<RepositorySnapshotResult> {
    // Revalidate runtime callers as well as response data. No response URL is a request target.
    if (typeof metadata.defaultBranch !== 'string' || !validBranch(metadata.defaultBranch)) {
      throw new ApplicationError(502, 'COMMIT_LOOKUP_FAILED', 'GitHub returned an unsupported default branch. Snapshot lookup is unavailable.');
    }
    const repository = publicMetadata({ owner: { login: metadata.owner }, name: metadata.name,
      html_url: metadata.url, private: metadata.private, archived: metadata.archived, default_branch: metadata.defaultBranch });
    const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const value = await this.requestJson(`${prefix}/commits/${encodeURIComponent(repository.defaultBranch)}`, { stage: 'commit' });
    if (value === EMPTY_REPOSITORY) {
      const issues = await this.getIssues(repository, prefix);
      return { status: 'empty', snapshot: null, message: 'This repository has no commit snapshot or files to scan yet.', issues };
    }
    const { commitSha, treeSha } = commitSnapshot(value);
    const tree = recursiveTree(await this.requestJson(`${prefix}/git/trees/${treeSha}?recursive=1`, { stage: 'tree', limit: 10 * 1024 * 1024 }), treeSha);
    const documents = await retrieveDocuments(repository, commitSha, tree, async (candidate: DocumentCandidate) => {
      const encodedPath = candidate.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
      const content = await this.requestJson(`${prefix}/contents/${encodedPath}?ref=${encodeURIComponent(commitSha)}`, { stage: 'content' });
      return content === CONTENT_UNAVAILABLE ? { status: 'unavailable' } : { status: 'available', value: content };
    });
    const analysis = { markdownLinks: analyzeRepositoryMarkdownTargets({ documents, tree }) };
    const issues = await this.getIssues(repository, prefix);
    return { status: 'ready', snapshot: { defaultBranch: repository.defaultBranch, commitSha, treeSha, tree, documents, analysis }, issues };
  }

  private async getIssues(repository: PublicRepositoryMetadata, prefix: string) {
    return retrieveIssues(repository, async (label, page) => {
      const query = `state=open&labels=${encodeURIComponent(label)}&sort=updated&direction=desc&per_page=100&page=${page}`;
      const response = await this.requestResponse(`${prefix}/issues?${query}`, { stage: 'issues' });
      return { value: response.value, link: response.headers.get('link') };
    }, this.now);
  }

  private async requestJson(path: string, options: { stage?: 'commit' | 'tree' | 'content' | 'issues'; limit?: number } = {}): Promise<unknown> {
    return (await this.requestResponse(path, options)).value;
  }

  private async requestResponse(path: string, options: { stage?: 'commit' | 'tree' | 'content' | 'issues'; limit?: number } = {}) {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'DocScout',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    try {
      const response = await this.fetcher(
        `${API_BASE}${path}`,
        { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) },
      );
      if (response.status === 200) return { value: await boundedJson(response, options.limit), headers: new Headers(response.headers) };
      if (response.status === 409 && options.stage === 'commit') {
        try {
          const message = record(await boundedJson(response))?.message;
          if (typeof message === 'string' && /^Git Repository is empty\.?$/i.test(message)) {
            return { value: EMPTY_REPOSITORY, headers: new Headers(response.headers) };
          }
        } catch { /* Unconfirmed conflicts remain commit failures. */ }
        throw new ApplicationError(502, 'COMMIT_LOOKUP_FAILED', 'The default branch commit could not be resolved. Please check the repository and retry.');
      }
      if (options.stage === 'content' && response.status !== 401 && response.status !== 403 && response.status !== 429) {
        await response.body?.cancel();
        return { value: CONTENT_UNAVAILABLE, headers: new Headers(response.headers) };
      }
      // Do not follow redirects, including GitHub repository-renaming redirects.
      // Every status consumes/cancels its body; errors never copy upstream messages.
      let limited = response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
        || response.headers.has('retry-after');
      if (response.status === 403 && !limited) {
        try {
          const message = record(await boundedJson(response))?.message;
          limited = typeof message === 'string' && /(?:secondary )?rate limit|abuse detection/i.test(message);
        } catch { /* A malformed error body must still produce a safe permission error. */ }
      } else {
        await response.body?.cancel();
      }
      if (response.status === 404 && !options.stage) {
        throw new ApplicationError(404, 'REPOSITORY_UNAVAILABLE', 'Repository unavailable. Check the URL; it may be private or missing.');
      }
      if (response.status === 401) {
        throw new ApplicationError(502, 'GITHUB_AUTH_ERROR', 'GitHub rejected the server credentials. Check the server GITHUB_TOKEN configuration.');
      }
      if ((response.status === 403 || response.status === 429) && limited) {
        throw new ApplicationError(503, 'GITHUB_COOLDOWN', 'GitHub requests are temporarily limited. Please retry later.', retryTime(response.headers));
      }
      if (response.status === 403) {
        throw new ApplicationError(502, 'GITHUB_FORBIDDEN', 'GitHub denied this request. Check repository availability and server token permissions.');
      }
      if (options.stage === 'commit' || options.stage === 'tree') {
        throw new ApplicationError(502, options.stage === 'commit' ? 'COMMIT_LOOKUP_FAILED' : 'TREE_LOOKUP_FAILED',
          options.stage === 'commit' ? 'The default branch commit could not be resolved. Please check the repository and retry.'
            : 'The pinned repository tree could not be retrieved. Path coverage is unavailable.');
      }
      throw upstreamError();
    } catch (error) {
      if (options.stage === 'content' && (!(error instanceof ApplicationError)
        || error.code === 'GITHUB_UPSTREAM_FAILURE')) return { value: CONTENT_UNAVAILABLE, headers: new Headers() };
      if (error instanceof ApplicationError) throw error;
      throw upstreamError('GitHub could not be reached. Please try again later.');
    }
  }
}
