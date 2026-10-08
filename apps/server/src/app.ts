import express from 'express';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '@docscout/shared';
import { GitHubClient } from './github/client.js';
import { repositoryRoute, type RepositoryRouteOptions } from './routes/repository.js';

export function createApp(options: { github?: GitHubClient; repositoryRouteOptions?: RepositoryRouteOptions } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => {
    const health: HealthResponse = { status: 'ok' };
    res.json(health);
  });
  app.use('/api/repository', repositoryRoute(
    options.github ?? new GitHubClient({ token: process.env.GITHUB_TOKEN }), options.repositoryRouteOptions,
  ));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint unavailable in Phase 0.' } });
  });

  if (process.env.NODE_ENV === 'production') {
    // Resolves from both src/app.ts and dist/apps/server/src/app.js.
    const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    const compiledWebRoot = fileURLToPath(new URL('../../../../../web/dist/', import.meta.url));
    const root = import.meta.url.includes('/dist/') ? compiledWebRoot : webRoot;
    app.use(express.static(root));
    app.get('/', (_req, res) => res.sendFile('index.html', { root }));
  }
  return app;
}
