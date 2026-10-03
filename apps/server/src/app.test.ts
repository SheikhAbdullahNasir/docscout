import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('Phase 0 API', () => {
  it('returns only basic status, even when credentials exist in the environment', async () => {
    process.env.GITHUB_TOKEN = 'test-only-sentinel';
    try {
      const response = await request(createApp()).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(response.text).not.toContain('test-only-sentinel');
    } finally {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('keeps analysis and AI endpoints unavailable in the metadata foundation', async () => {
    for (const path of ['/api/analyze', '/api/explain', '/api/unknown']) {
      expect((await request(createApp()).post(path)).status).toBe(404);
    }
  });
});
