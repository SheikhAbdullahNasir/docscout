import type { PublicRepositoryMetadata, RepositoryDocuments, RepositoryScanCoverage, RepositorySnapshotData, RepositorySnapshotResult } from '@docscout/shared';
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
import { githubRequestQueue, type GitHubRequestQueue } from './requestQueue.js';

const API_BASE = 'https://api.github.com';
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_MS = 8.64e15;
const RETRYABLE_5XX = new Set([500, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EMPTY_REPOSITORY = Symbol('empty-repository');
const CONTENT_UNAVAILABLE = Symbol('content-unavailable');
type RequestStage = 'commit' | 'tree' | 'content' | 'issues';
type RequestResult = { value: unknown; headers: Headers };

class TransientNetworkFailure extends Error {}

class RetryableAttemptFailure extends Error {
  constructor(readonly finalError: ApplicationError, readonly contentUnavailable = false) { super(); }
}

class GitHubCooldownError extends ApplicationError {
  constructor(readonly retryAtMs?: number) {
    super(503, 'GITHUB_COOLDOWN', 'GitHub requests are temporarily limited. Please retry later.',
      retryAtMs === undefined ? undefined : new Date(retryAtMs).toISOString());
  }
}

function upstreamError(message = 'GitHub returned an unavailable or invalid response. Please try again later.') {
  return new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', message);
}

function validatedGitHubRedirect(location: string | null, currentUrl: URL): URL | undefined {
  if (!location || location.length > 2048) return undefined;
  let target: URL;
  try { target = new URL(location, currentUrl); }
  catch { return undefined; }

  if (target.origin !== API_BASE || target.username || target.password || target.hash
    || target.search !== currentUrl.search) return undefined;

  const repositoryEndpoint = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/u;
  const current = repositoryEndpoint.exec(currentUrl.pathname);
  const redirected = repositoryEndpoint.exec(target.pathname);
  if (current && redirected && validOwner(redirected[1]) && validRepo(redirected[2])
    && (redirected[3] ?? '') === (current[3] ?? '')) return target;
  return undefined;
}

async function boundedJson(response: Response, signal: AbortSignal, checkTime: () => void, limit = RESPONSE_LIMIT): Promise<unknown> {
  if (!response.body) throw upstreamError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      checkTime();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await abortable(reader.read(), signal); }
      catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof TypeError) throw new TransientNetworkFailure();
        throw error;
      }
      const { done, value } = chunk;
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

function retryTime(headers: Headers, now: number): number | undefined {
  const retry = headers.get('retry-after')?.trim();
  const reset = headers.get('x-ratelimit-reset')?.trim();
  const candidates: number[] = [];
  if (retry && /^\d+$/.test(retry)) {
    const seconds = Number(retry);
    const time = now + seconds * 1000;
    if (Number.isSafeInteger(seconds) && seconds <= MAX_COOLDOWN_MS / 1000 && Number.isSafeInteger(time)) candidates.push(time);
  } else if (retry && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retry)) {
    const time = Date.parse(retry);
    if (Number.isFinite(time) && new Date(time).toUTCString() === retry) candidates.push(time);
  }
  if (reset && /^\d+$/.test(reset)) {
    const seconds = Number(reset);
    const time = seconds * 1000;
    if (Number.isSafeInteger(seconds) && Number.isSafeInteger(time)) candidates.push(time);
  }
  const safeTimes = candidates.filter((time) => Number.isFinite(time) && time >= now
    && time <= MAX_DATE_MS && time - now <= MAX_COOLDOWN_MS);
  // Honor every valid lower bound; the later validated time is the earliest safe retry.
  return safeTimes.length ? Math.max(...safeTimes) : undefined;
}

function final5xxError(stage?: RequestStage): ApplicationError {
  if (stage === 'commit') return new ApplicationError(502, 'COMMIT_LOOKUP_FAILED',
    'The default branch commit could not be resolved. Please check the repository and retry.');
  if (stage === 'tree') return new ApplicationError(502, 'TREE_LOOKUP_FAILED',
    'The pinned repository tree could not be retrieved. Path coverage is unavailable.');
  return upstreamError();
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export class GitHubClient {
  private readonly fetcher: typeof fetch;
  private readonly token?: string;
  private readonly now: () => Date;
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly queue: GitHubRequestQueue;

  constructor(options: {
    fetcher?: typeof fetch;
    token?: string;
    now?: () => Date;
    clock?: () => number;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    queue?: GitHubRequestQueue;
  } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.token = options.token?.trim() || undefined;
    this.now = options.now ?? (() => new Date());
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.queue = options.queue ?? githubRequestQueue;
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
      const warnings = budget.warnings;
      const scan: RepositoryScanCoverage = {
        status: warnings.length ? 'partial' : 'complete',
        githubRequests: budget.requestsUsed,
        warnings,
      };
      return { ...result, scan };
    } finally { if (!sharedBudget) budget.dispose(); }
  }

  private async snapshot(metadata: PublicRepositoryMetadata, budget: ScanBudget): Promise<RepositorySnapshotData> {
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

  private async requestJson(path: string, budget: ScanBudget, options: { stage?: RequestStage } = {}): Promise<unknown> {
    return (await this.requestResponse(path, budget, options)).value;
  }

  private async requestResponse(path: string, budget: ScanBudget, options: { stage?: RequestStage } = {}): Promise<RequestResult> {
    let retried = false;
    while (true) {
      try {
        return await this.queue.run(budget.signal, () => budget.consumeRequest(),
          () => this.requestAttempt(path, budget, options));
      } catch (error) {
        if (error instanceof GitHubCooldownError) {
          const delay = error.retryAtMs === undefined ? undefined : Math.max(0, error.retryAtMs - this.clock());
          if (!retried && delay !== undefined && this.canRetry(budget, delay)) {
            retried = true;
            if (delay > 0) await abortable(this.sleep(delay, budget.signal), budget.signal);
            budget.checkDeadline();
            continue;
          }
          throw error;
        }

        const retryable = error instanceof RetryableAttemptFailure
          || error instanceof ApplicationError && error.code === 'GITHUB_REQUEST_TIMEOUT' && !budget.signal.aborted;
        if (!retried && retryable && this.canRetry(budget)) {
          retried = true;
          continue;
        }
        if (isResourceError(error)) budget.note(error);
        if (error instanceof RetryableAttemptFailure) {
          if (error.contentUnavailable) return { value: CONTENT_UNAVAILABLE, headers: new Headers() };
          throw error.finalError;
        }
        throw error;
      }
    }
  }

  private canRetry(budget: ScanBudget, delayMs = 0) {
    return !budget.signal.aborted && budget.remainingRequests > 0 && delayMs < budget.remainingTimeMs;
  }

  private async requestAttempt(path: string, budget: ScanBudget, options: { stage?: RequestStage }): Promise<RequestResult> {
    const controller = new AbortController();
    const remainingAtStart = budget.remainingTimeMs;
    const timeoutError = () => new ApplicationError(504, 'GITHUB_REQUEST_TIMEOUT',
      'A GitHub request reached its 10-second timeout. Only completed repository evidence is shown.');
    const timer = setTimeout(() => controller.abort(timeoutError()), REQUEST_TIMEOUT_MS);
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
    let url = new URL(`${API_BASE}${path}`);
    let followedRedirect = false;
    try {
      while (true) {
        try {
          response = await abortable(this.fetcher(
            url.href,
            { method: 'GET', headers, redirect: 'manual', signal },
          ), signal);
        } catch (error) {
          if (signal.aborted) throw error;
          if (error instanceof TypeError) throw new TransientNetworkFailure();
          throw error;
        }
        checkTime();
        if (!REDIRECT_STATUSES.has(response.status)) break;

        const target = followedRedirect ? undefined : validatedGitHubRedirect(response.headers.get('location'), url);
        if (!target) break;
        if (response.body) await abortable(response.body.cancel(), signal);
        budget.consumeRequest();
        followedRedirect = true;
        url = target;
      }
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
      if (RETRYABLE_5XX.has(response.status)) {
        if (response.body) await abortable(response.body.cancel(), signal);
        throw new RetryableAttemptFailure(final5xxError(options.stage), options.stage === 'content');
      }
      if (options.stage === 'content' && response.status !== 401 && response.status !== 403 && response.status !== 429) {
        if (response.body) await abortable(response.body.cancel(), signal);
        return { value: CONTENT_UNAVAILABLE, headers: new Headers(response.headers) };
      }
      // Every other status consumes/cancels its body; errors never copy upstream messages.
      const retryAtMs = retryTime(response.headers, this.clock());
      const primaryLimit = response.headers.get('x-ratelimit-remaining')?.trim() === '0';
      let secondaryLimit = false;
      let inspectedForbiddenBody = false;
      if (response.status === 403 && !primaryLimit && retryAtMs === undefined) {
        inspectedForbiddenBody = true;
        try {
          const message = record(await boundedJson(response, signal, checkTime))?.message;
          secondaryLimit = typeof message === 'string' && /(?:secondary )?rate limit|abuse detection/i.test(message);
        } catch (error) {
          if (isResourceError(error) || error instanceof TransientNetworkFailure) throw error;
          // Malformed error bodies remain safe permission errors.
        }
      }
      const limited = response.status === 429 || primaryLimit
        || response.status === 403 && (retryAtMs !== undefined || secondaryLimit);
      if (!inspectedForbiddenBody && response.body) await abortable(response.body.cancel(), signal);
      if (response.status === 404 && !options.stage) {
        throw new ApplicationError(404, 'REPOSITORY_UNAVAILABLE', 'Repository unavailable. Check the URL; it may be private or missing.');
      }
      if (response.status === 401) {
        throw new ApplicationError(502, 'GITHUB_AUTH_ERROR', 'GitHub rejected the server credentials. Check the server GITHUB_TOKEN configuration.');
      }
      if ((response.status === 403 || response.status === 429) && limited) {
        throw new GitHubCooldownError(retryAtMs);
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
        controller.abort(error);
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
        throw error;
      }
      if (error instanceof GitHubCooldownError || error instanceof RetryableAttemptFailure) throw error;
      if (error instanceof TransientNetworkFailure) {
        throw new RetryableAttemptFailure(upstreamError('GitHub could not be reached. Please try again later.'), options.stage === 'content');
      }
      if (options.stage === 'content' && (!(error instanceof ApplicationError)
        || error.code === 'GITHUB_UPSTREAM_FAILURE')) return { value: CONTENT_UNAVAILABLE, headers: new Headers() };
      if (error instanceof ApplicationError) throw error;
      throw upstreamError('GitHub could not be reached. Please try again later.');
    } finally { clearTimeout(timer); }
  }
}
