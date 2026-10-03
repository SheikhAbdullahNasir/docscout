import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { GitHubClient } from '../github/client.js';

const body = {
  owner: { login: 'Owner' }, name: 'repo', html_url: 'https://github.com/Owner/repo',
  private: false, archived: false, default_branch: 'develop',
};

describe('metadata-only API', () => {
  it('returns a typed canonical metadata result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    const app = createApp({ github: new GitHubClient({ fetcher }) });
    const response = await request(app).post('/api/repository').send({ repositoryUrl: ' https://github.com/owner/repo.git/ ' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ schemaVersion: 1, repository: { owner: 'Owner', name: 'repo', url: body.html_url, private: false, archived: false, defaultBranch: 'develop' } });
  });

  it.each([{}, null, [], { repositoryUrl: 2 }, { repositoryUrl: 'https://evil.test/owner/repo' }, { repositoryUrl: 'https://github.com:443/owner/repo' }])('rejects invalid request without outbound traffic: %j', async (body) => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) })).post('/api/repository').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REPOSITORY_URL');
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns safe JSON for malformed and oversized bodies', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = createApp({ github: new GitHubClient({ fetcher }) });
    for (const [body, status] of [['{bad', 400], [JSON.stringify({ repositoryUrl: 'x'.repeat(5000) }), 413]] as const) {
      const response = await request(app).post('/api/repository').type('json').send(body);
      expect(response.status).toBe(status);
      expect(response.body.error.message).toEqual(expect.any(String));
      expect(response.body.stack).toBeUndefined();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['Content-Encoding', 'unsupported'],
    ['Content-Type', 'application/json; charset=iso-8859-1'],
  ])('returns an input error for unsupported %s', async (header, value) => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) }))
      .post('/api/repository').type('json').set(header, value).send('{"repositoryUrl":"https://github.com/owner/repo"}');
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('INVALID_REQUEST_BODY');
    expect(response.body.error.message).toContain('UTF-8');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serializes only safe error fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'secret-sentinel' }, { status: 401 }));
    const response = await request(createApp({ github: new GitHubClient({ fetcher, token: 'secret-sentinel' }) })).post('/api/repository').send({ repositoryUrl: 'https://github.com/owner/repo' });
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('GITHUB_AUTH_ERROR');
    expect(response.text).not.toContain('secret-sentinel');
    expect(response.text).not.toContain('stack');
  });

  it.each([
    [404, 'REPOSITORY_UNAVAILABLE', 404], [403, 'GITHUB_FORBIDDEN', 502],
    [429, 'GITHUB_COOLDOWN', 503], [503, 'GITHUB_UPSTREAM_FAILURE', 502],
  ])('returns readable JSON for upstream HTTP %i', async (status, code, expectedStatus) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'upstream-secret' }, { status }));
    const response = await request(createApp({ github: new GitHubClient({ fetcher }) }))
      .post('/api/repository').send({ repositoryUrl: 'https://github.com/owner/repo' });
    expect(response.status).toBe(expectedStatus);
    expect(response.body).toEqual({ error: { code, message: expect.any(String) }, requestId: expect.any(String) });
    expect(response.text).not.toContain('upstream-secret');
  });

  it('does not return private repository identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...body, private: true, name: 'secret-repo' }));
    const response = await request(createApp({ github: new GitHubClient({ fetcher, token: 'test-token' }) }))
      .post('/api/repository').send({ repositoryUrl: 'https://github.com/owner/repo' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRIVATE_REPOSITORY');
    expect(response.text).not.toContain('secret-repo');
  });

  it('uses GITHUB_TOKEN from the server environment without returning it', async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'environment-token-sentinel';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    vi.stubGlobal('fetch', fetcher);
    try {
      const response = await request(createApp()).post('/api/repository').send({ repositoryUrl: 'https://github.com/owner/repo' });
      expect(response.status).toBe(200);
      expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer environment-token-sentinel');
      expect(response.text).not.toContain('environment-token-sentinel');
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});
