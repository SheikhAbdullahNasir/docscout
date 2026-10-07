import type { PublicRepositoryMetadata, RepositoryDocuments, RepositorySnapshotResult } from '@docscout/shared';
import { ApplicationError } from '../errors.js';
import { analyzeRepositoryMarkdownTargets } from '../analyzers/localLinks.js';
import { analyzeReadmeNpmScripts } from '../analyzers/npmScripts.js';
import { analyzeLabeledIssues } from '../analyzers/labeledIssues.js';
import { combineFindings } from '../analyzers/analysis.js';
import { validOwner, validRepo, type ValidatedRepository } from '../security/repositoryUrl.js';
import { retrieveDocuments, type DocumentCandidate } from './documents.js';
import { retrieveIssues } from './issues.js';
import { commitSnapshot, recursiveTree, validBranch } from './snapshot.js';
import { abortable, isResourceError, ScanBudget } from './scanBudget.js';

const API_BASE = 'https://api.github.com';
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const EMPTY_REPOSITORY = Symbol('empty-repository');
const CONTENT_UNAVAILABLE = Symbol('content-unavailable');

function upstreamError(message = 'GitHub returned an unavailable or invalid response. Please try again later.') {
  return new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', message);
}

async function boundedJson(response: Response, signal: AbortSignal, checkTime: () => void, limit = RESPONSE_LIMIT): Promise<unknown> {
  if (!response.body) throw upstreamError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      checkTime();
      const { done, value } = await abortable(reader.read(), signal);
      checkTime();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ApplicationError(502, 'GITHUB_RESPONSE_TOO_LARGE',
        'GitHub returned a response larger than the safe size limit. That response was not used as repository evidence.');
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    checkTime();
    return value;
  } finally {
    void reader.cancel().catch(() => undefined);
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
  private readonly clock: () => number;

  constructor(options: { fetcher?: typeof fetch; token?: string; now?: () => Date; clock?: () => number } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.token = options.token?.trim() || undefined;
    this.now = options.now ?? (() => new Date());
    this.clock = options.clock ?? Date.now;
  }

  createScanBudget() { return new ScanBudget({ now: this.clock }); }

  async getRepository(repository: ValidatedRepository, sharedBudget?: ScanBudget): Promise<PublicRepositoryMetadata> {
    const budget = sharedBudget ?? this.createScanBudget();
    try {
      // Defense in depth for runtime callers; never construct a path from unchecked segments.
      if (!validOwner(repository.owner) || !validRepo(repository.repo)) {
        throw new ApplicationError(400, 'INVALID_REPOSITORY_URL', 'Enter https://github.com/owner/repo.');
      }
      return publicMetadata(await this.requestJson(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`, budget));
    } finally { if (!sharedBudget) budget.dispose(); }
  }

  async getSnapshot(metadata: PublicRepositoryMetadata, sharedBudget?: ScanBudget): Promise<RepositorySnapshotResult> {
    const budget = sharedBudget ?? this.createScanBudget();
    try {
      const result = await this.snapshot(metadata, budget);
      // Finalize useful completed evidence even if the deadline was reached during local processing.
      try { budget.checkDeadline(); } catch (error) { budget.note(error); }
      return budget.warnings.length
        ? { ...result, scan: { status: 'partial', githubRequests: budget.requestsUsed, warnings: budget.warnings } }
        : result;
    } finally { if (!sharedBudget) budget.dispose(); }
  }

  private async snapshot(metadata: PublicRepositoryMetadata, budget: ScanBudget): Promise<RepositorySnapshotResult> {
    // Revalidate runtime callers as well as response data. No response URL is a request target.
    if (typeof metadata.defaultBranch !== 'string' || !validBranch(metadata.defaultBranch)) {
      throw new ApplicationError(502, 'COMMIT_LOOKUP_FAILED', 'GitHub returned an unsupported default branch. Snapshot lookup is unavailable.');
    }
    const repository = publicMetadata({ owner: { login: metadata.owner }, name: metadata.name,
      html_url: metadata.url, private: metadata.private, archived: metadata.archived, default_branch: metadata.defaultBranch });
    const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const value = await this.requestJson(`${prefix}/commits/${encodeURIComponent(repository.defaultBranch)}`, budget, { stage: 'commit' });
    if (value === EMPTY_REPOSITORY) {
      const issues = await this.getIssues(repository, prefix, budget);
      const labeledIssues = analyzeLabeledIssues({ repository, issues });
      const analysis = { ...combineFindings([], [], labeledIssues.findings, 0), labeledIssues };
      return { status: 'empty', snapshot: null, message: 'This repository has no commit snapshot or files to scan yet.', issues, analysis };
    }
    const { commitSha, treeSha } = commitSnapshot(value);
    const tree = recursiveTree(await this.requestJson(`${prefix}/git/trees/${treeSha}?recursive=1`, budget, { stage: 'tree' }), treeSha);
    const documents = await retrieveDocuments(repository, commitSha, tree, async (candidate: DocumentCandidate) => {
      const encodedPath = candidate.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
      try {
        const content = await this.requestJson(`${prefix}/contents/${encodedPath}?ref=${encodeURIComponent(commitSha)}`, budget, { stage: 'content' });
        return content === CONTENT_UNAVAILABLE ? { status: 'unavailable' } : { status: 'available', value: content };
      } catch (error) {
        if (!isResourceError(error)) throw error;
        return { status: 'unavailable', reason: error.code, message: error.message };
      }
    });
    // Parsing new documents is work too. At the deadline, finalize an unchecked
    // analysis scope without parsing their retained preview text.
    const documentScope = (): RepositoryDocuments => {
      try { budget.checkDeadline(); return documents; }
      catch (error) {
        if (!isResourceError(error)) throw error;
        const unchecked = { status: 'unknown' as const, message: 'Document analysis was not started before the scan deadline.' };
        return { ...documents, readme: unchecked, contributing: unchecked, packageJson: unchecked, docs: [] };
      }
    };
    const markdownScope = documentScope();
    const markdownLinks = analyzeRepositoryMarkdownTargets({ documents: markdownScope, tree });
    if (markdownScope !== documents) {
      const unchecked = documents.docs.length
        + [documents.readme, documents.contributing].filter(({ status }) => status === 'available').length;
      markdownLinks.coverage.documentsUnchecked = unchecked;
      markdownLinks.coverage.uncheckedDocumentsByReason.scanDeadline = unchecked;
      markdownLinks.coverage.limitations.push('Document parsing was not started after the scan deadline; retained documents remain unchecked.');
    }
    const npmScope = documentScope();
    const npmScripts = analyzeReadmeNpmScripts({ documents: npmScope });
    if (npmScope !== documents) npmScripts.coverage.skipReason = 'scan-deadline';
    const issues = await this.getIssues(repository, prefix, budget);
    const labeledIssues = analyzeLabeledIssues({ repository, issues });
    const combined = combineFindings(
      markdownLinks.findings,
      npmScripts.findings,
      labeledIssues.findings,
      markdownLinks.coverage.findingsOmitted + npmScripts.coverage.findingsOmitted,
    );
    const analysis = {
      ...combined,
      markdownLinks,
      npmScripts,
      labeledIssues,
    };
    return { status: 'ready', snapshot: { defaultBranch: repository.defaultBranch, commitSha, treeSha, tree, documents, analysis }, issues };
  }

  private async getIssues(repository: PublicRepositoryMetadata, prefix: string, budget: ScanBudget) {
    return retrieveIssues(repository, async (label, page) => {
      const query = `state=open&labels=${encodeURIComponent(label)}&sort=updated&direction=desc&per_page=100&page=${page}`;
      const response = await this.requestResponse(`${prefix}/issues?${query}`, budget, { stage: 'issues' });
      return { value: response.value, link: response.headers.get('link') };
    }, this.now);
  }

  private async requestJson(path: string, budget: ScanBudget, options: { stage?: 'commit' | 'tree' | 'content' | 'issues' } = {}): Promise<unknown> {
    return (await this.requestResponse(path, budget, options)).value;
  }

  private async requestResponse(path: string, budget: ScanBudget, options: { stage?: 'commit' | 'tree' | 'content' | 'issues' } = {}) {
    budget.consumeRequest();
    const controller = new AbortController();
    const remainingAtStart = budget.remainingTimeMs;
    const timeoutError = () => new ApplicationError(504, 'GITHUB_REQUEST_TIMEOUT',
      'A GitHub request reached its 10-second timeout. Only completed repository evidence is shown.');
    const timer = setTimeout(() => controller.abort(timeoutError()), 10_000);
    timer.unref?.();
    const signal = AbortSignal.any([budget.signal, controller.signal]);
    const checkTime = () => {
      budget.checkDeadline();
      if (remainingAtStart - budget.remainingTimeMs >= 10_000) controller.abort(timeoutError());
      signal.throwIfAborted();
    };
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'DocScout',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response: Response | undefined;
    try {
      response = await abortable(this.fetcher(
        `${API_BASE}${path}`,
        { method: 'GET', headers, redirect: 'manual', signal },
      ), signal);
      checkTime();
      if (response.status === 200) return { value: await boundedJson(response, signal, checkTime,
        options.stage === 'tree' ? 10 * 1024 * 1024 : RESPONSE_LIMIT), headers: new Headers(response.headers) };
      if (response.status === 409 && options.stage === 'commit') {
        try {
          const message = record(await boundedJson(response, signal, checkTime))?.message;
          if (typeof message === 'string' && /^Git Repository is empty\.?$/i.test(message)) {
            return { value: EMPTY_REPOSITORY, headers: new Headers(response.headers) };
          }
        } catch (error) { if (isResourceError(error)) throw error; /* Unconfirmed conflicts remain commit failures. */ }
        throw new ApplicationError(502, 'COMMIT_LOOKUP_FAILED', 'The default branch commit could not be resolved. Please check the repository and retry.');
      }
      if (options.stage === 'content' && response.status !== 401 && response.status !== 403 && response.status !== 429) {
        if (response.body) await abortable(response.body.cancel(), signal);
        return { value: CONTENT_UNAVAILABLE, headers: new Headers(response.headers) };
      }
      // Do not follow redirects, including GitHub repository-renaming redirects.
      // Every status consumes/cancels its body; errors never copy upstream messages.
      let limited = response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0'
        || response.headers.has('retry-after');
      if (response.status === 403 && !limited) {
        try {
          const message = record(await boundedJson(response, signal, checkTime))?.message;
          limited = typeof message === 'string' && /(?:secondary )?rate limit|abuse detection/i.test(message);
        } catch (error) { if (isResourceError(error)) throw error; /* Malformed error bodies remain safe permission errors. */ }
      } else {
        if (response.body) await abortable(response.body.cancel(), signal);
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
    } catch (caught) {
      let error: unknown = signal.aborted ? signal.reason : caught;
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        error = new ApplicationError(504, 'GITHUB_REQUEST_TIMEOUT', 'A GitHub request timed out. Please try again later.');
      }
      if (isResourceError(error)) {
        budget.note(error);
        controller.abort(error);
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
        throw error;
      }
      if (options.stage === 'content' && (!(error instanceof ApplicationError)
        || error.code === 'GITHUB_UPSTREAM_FAILURE')) return { value: CONTENT_UNAVAILABLE, headers: new Headers() };
      if (error instanceof ApplicationError) throw error;
      throw upstreamError('GitHub could not be reached. Please try again later.');
    } finally { clearTimeout(timer); }
  }
}
