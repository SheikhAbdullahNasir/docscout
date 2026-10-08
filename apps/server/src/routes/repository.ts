import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import type { RepositoryErrorResponse, RepositoryMetadataResponse, RepositorySnapshotResponse } from '@docscout/shared';
import { ApplicationError } from '../errors.js';
import { GitHubClient } from '../github/client.js';
import { parseRepositoryUrl } from '../security/repositoryUrl.js';
import { boundBrowserResponse } from './browserBudget.js';
import { CompletedScanCache, ScanCoordinator } from './scanCache.js';

export type RepositoryRouteOptions = { now?: () => number };

function watchRequestDisconnect(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new ApplicationError(499, 'SCAN_CANCELLED', 'The scan was cancelled because its request disconnected.'));
    }
  };
  const onResponseClose = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', onResponseClose);
  if (req.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener('aborted', abort);
      res.removeListener('close', onResponseClose);
    },
  };
}

function repositoryScanKey(input: { owner: string; repo: string }) {
  // Validation already removed accepted URL decoration and preserved case.
  return JSON.stringify([input.owner, input.repo]);
}

export function repositoryRoute(github: GitHubClient, options: RepositoryRouteOptions = {}) {
  const router = express.Router();
  const now = options.now ?? Date.now;
  const cache = new CompletedScanCache<RepositorySnapshotResponse>({ now });
  const scans = new ScanCoordinator(cache, (result) => result.status === 'ready' || result.status === 'empty');
  const readRepositoryUrl = (body: unknown) => body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).repositoryUrl : undefined;
  router.post('/', express.json({ limit: '4kb', strict: false }), async (req, res) => {
    const body: unknown = req.body;
    const repository = await github.getRepository(parseRepositoryUrl(readRepositoryUrl(body)));
    const result: RepositoryMetadataResponse = { schemaVersion: 1, repository };
    res.json(result);
  });
  router.post('/snapshot', express.json({ limit: '4kb', strict: false }), async (req, res) => {
    const input = parseRepositoryUrl(readRepositoryUrl(req.body));
    const disconnected = watchRequestDisconnect(req, res);
    try {
      const { result, cached } = await scans.run(repositoryScanKey(input), disconnected.signal, () => {
        const budget = github.createScanBudget();
        const scannedAt = new Date(now()).toISOString();
        const promise = (async (): Promise<RepositorySnapshotResponse> => {
          try {
            const repository = await github.getRepository(input, budget);
            const snapshot = await github.getSnapshot(repository, budget);
            const response: RepositorySnapshotResponse = { schemaVersion: 1, repository, ...snapshot, scannedAt, cached: false };
            return boundBrowserResponse(response, budget.requestsUsed);
          } finally { budget.dispose(); }
        })();
        return {
          promise,
          cancel: () => budget.cancel(new ApplicationError(499, 'SCAN_CANCELLED', 'The scan was cancelled because no callers remain.')),
        };
      });
      if (!res.destroyed && !res.writableEnded) res.json({ ...result, cached });
    } finally { disconnected.dispose(); }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    // Express recognizes error middleware by its four-argument signature.
    void _next;
    if (res.destroyed || res.writableEnded) return;
    let safe: ApplicationError;
    if (error instanceof ApplicationError) safe = error;
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      safe = new ApplicationError(413, 'REQUEST_TOO_LARGE', 'Request body must be no larger than 4 KiB.');
    } else if (error && typeof error === 'object' && 'type' in error
      && (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported')) {
      safe = new ApplicationError(415, 'INVALID_REQUEST_BODY', 'Send UTF-8 JSON with a supported content encoding.');
    } else if (error instanceof SyntaxError) {
      safe = new ApplicationError(400, 'INVALID_REQUEST_BODY', 'Send valid JSON with a repositoryUrl string.');
    } else {
      safe = new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', 'Repository metadata could not be retrieved. Please try again later.');
    }
    const result: RepositoryErrorResponse = {
      error: { code: safe.code, message: safe.message, ...(safe.retryAt ? { retryAt: safe.retryAt } : {}) },
      requestId: randomUUID(),
    };
    res.status(safe.status).json(result);
  };
  router.use(errors);
  return router;
}
