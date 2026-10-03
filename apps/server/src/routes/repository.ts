import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import type { RepositoryErrorResponse, RepositoryMetadataResponse } from '@docscout/shared';
import { ApplicationError } from '../errors.js';
import { GitHubClient } from '../github/client.js';
import { parseRepositoryUrl } from '../security/repositoryUrl.js';

export function repositoryRoute(github: GitHubClient) {
  const router = express.Router();
  router.post('/', express.json({ limit: '4kb', strict: false }), async (req, res) => {
    const body: unknown = req.body;
    const repositoryUrl = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).repositoryUrl : undefined;
    const repository = await github.getRepository(parseRepositoryUrl(repositoryUrl));
    const result: RepositoryMetadataResponse = { schemaVersion: 1, repository };
    res.json(result);
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    // Express recognizes error middleware by its four-argument signature.
    void _next;
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
