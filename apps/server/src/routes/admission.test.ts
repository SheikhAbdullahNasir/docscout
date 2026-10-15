import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { GitHubClient } from '../github/client.js';

const metadata = { owner: { login: 'Canonical' }, name: 'Repo', html_url: 'https://github.com/Canonical/Repo', private: false, archived: false, default_branch: 'main' };
const commitSha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const input = { repositoryUrl: 'https://github.com/input/repo' };

function successfulFetcher(scans = 1) {
  const fetcher = vi.fn<typeof fetch>();
  for (let scan = 0; scan < scans; scan += 1) {
    fetcher.mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ sha: commitSha, commit: { tree: { sha: treeSha } } }))
      .mockResolvedValueOnce(Response.json({ sha: treeSha, truncated: false, tree: [] }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]));
  }
  return fetcher;
}

describe('analysis admission and request origin', () => {
  it('allows five analyze requests in a ten-minute window and rejects the sixth before GitHub work', async () => {
    let now = Date.parse('2026-10-08T00:00:00.000Z');
    const fetcher = successfulFetcher(2);
    const app = createApp({ github: new GitHubClient({ fetcher }), repositoryRouteOptions: { now: () => now } });

    const allowed = [];
    for (let index = 0; index < 5; index += 1) {
      allowed.push(await request(app).post('/api/repository/snapshot').send(input));
    }
    const rejected = await request(app).post('/api/repository/snapshot').send(input);

    expect(allowed.map(({ status }) => status)).toEqual([200, 200, 200, 200, 200]);
    expect(rejected.status).toBe(429);
    expect(rejected.body.error.code).toBe('ANALYZE_RATE_LIMITED');
    expect(rejected.body.error.retryAt).toBe(new Date(now + 10 * 60 * 1000).toISOString());
    expect(Number(rejected.headers['retry-after'])).toBe(600);
    expect(rejected.text).not.toMatch(/counter|proxy|127\.0\.0\.1|::ffff/i);
    expect(fetcher).toHaveBeenCalledTimes(5);

    now += 10 * 60 * 1000;
    const expired = await request(app).post('/api/repository/snapshot').send(input);
    expect(expired.status).toBe(200);
  });

  it('ignores arbitrary forwarded-for headers when proxy trust is disabled', async () => {
    const fetcher = successfulFetcher();
    const app = createApp({ github: new GitHubClient({ fetcher }), trustedProxy: '' });
    const responses = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(await request(app).post('/api/repository/snapshot')
        .set('X-Forwarded-For', `198.51.100.${index + 1}`).send(input));
    }
    const rejected = await request(app).post('/api/repository/snapshot')
      .set('X-Forwarded-For', '203.0.113.99').send(input);

    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(rejected.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('uses the client address supplied through an explicitly trusted proxy and separates client counters', async () => {
    vi.stubEnv('TRUSTED_PROXY', '127.0.0.1/32, ::1/128');
    try {
      const fetcher = successfulFetcher();
      const app = createApp({ github: new GitHubClient({ fetcher }) });
      const responses = [];
      for (let index = 0; index < 5; index += 1) {
        responses.push(await request(app).post('/api/repository/snapshot')
          .set('X-Forwarded-For', `192.0.2.${index + 1}, 203.0.113.7`).send(input));
      }
      const firstClientRejected = await request(app).post('/api/repository/snapshot')
        .set('X-Forwarded-For', '192.0.2.99, 203.0.113.7').send(input);
      const separateClientAllowed = await request(app).post('/api/repository/snapshot')
        .set('X-Forwarded-For', '192.0.2.99, 203.0.113.8').send(input);

      expect(responses.every(({ status }) => status === 200)).toBe(true);
      expect(firstClientRejected.status).toBe(429);
      expect(separateClientAllowed.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects unsafe trust-everything proxy settings', () => {
    expect(() => createApp({ trustedProxy: '*' })).toThrow();
    expect(() => createApp({ trustedProxy: '0.0.0.0/0' })).toThrow();
  });

  it('allows same-origin mutation requests and rejects a foreign Origin before GitHub work', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const fetcher = successfulFetcher();
      const app = createApp({ github: new GitHubClient({ fetcher }) });

      const sameOrigin = await request(app).post('/api/repository/snapshot')
        .set('Host', 'api.example.test').set('Origin', 'http://api.example.test').send(input);
      const foreignOrigin = await request(app).post('/api/repository/snapshot')
        .set('Host', 'api.example.test').set('Origin', 'https://attacker.example').send(input);

      expect(sameOrigin.status).toBe(200);
      expect(foreignOrigin.status).toBe(403);
      expect(foreignOrigin.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows the Railway public HTTPS origin without trusting forwarded headers and rejects a foreign origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_SERVICE_ID', 'railway-service-test');
    vi.stubEnv('RAILWAY_PUBLIC_DOMAIN', 'docscoutserver-production.up.railway.app');
    try {
      const fetcher = successfulFetcher();
      const app = createApp({ github: new GitHubClient({ fetcher }), trustedProxy: '' });
      const host = 'docscoutserver-production.up.railway.app';
      const health = await request(app).get('/api/health');
      const legitimateOrigin = await request(app).post('/api/repository/snapshot')
        .set('Host', host)
        .set('Origin', `https://${host}`)
        .set('X-Forwarded-Proto', 'https')
        .send(input);
      const maliciousOrigin = await request(app).post('/api/repository/snapshot')
        .set('Host', host)
        .set('Origin', 'https://attacker.example')
        .set('X-Forwarded-Proto', 'https')
        .send(input);
      const mismatchedHost = await request(app).post('/api/repository/snapshot')
        .set('Host', 'attacker.example')
        .set('Origin', `https://${host}`)
        .set('X-Forwarded-Proto', 'https')
        .send(input);

      expect(app.get('trust proxy')).toBe(false);
      expect(health.status).toBe(200);
      expect(health.body).toEqual({ status: 'ok' });
      expect(legitimateOrigin.status).toBe(200);
      expect(maliciousOrigin.status).toBe(403);
      expect(maliciousOrigin.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(mismatchedHost.status).toBe(403);
      expect(mismatchedHost.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('validates Origin on metadata POST requests too', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) }))
      .post('/api/repository').set('Host', 'api.example.test').set('Origin', 'https://attacker.example')
      .send(input);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows absent Origin for non-browser clients', async () => {
    const fetcher = successfulFetcher();
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) }))
      .post('/api/repository/snapshot').send(input);

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('allows only the configured local Vite origin during development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    try {
      const fetcher = successfulFetcher();
      const app = createApp({ github: new GitHubClient({ fetcher }) });
      const allowed = await request(app).post('/api/repository/snapshot')
        .set('Host', '127.0.0.1:3001').set('Origin', 'http://localhost:5173').send(input);
      const rejected = await request(app).post('/api/repository/snapshot')
        .set('Host', '127.0.0.1:3001').set('Origin', 'http://localhost:5174').send(input);

      expect(allowed.status).toBe(200);
      expect(rejected.status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
