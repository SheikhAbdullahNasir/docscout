import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, ['apps/server/dist/apps/server/src/index.js'], {
  env: { ...process.env, PORT: '3101', NODE_ENV: 'production' },
  stdio: 'inherit',
});
try {
  let health;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before becoming ready.');
    try {
      health = await fetch('http://127.0.0.1:3101/api/health');
      if (health.ok) break;
    } catch { /* Wait for local startup only. */ }
    await delay(100);
  }
  assert.ok(health?.ok, 'Production health endpoint must become ready');
  assert.deepEqual(await health.json(), { status: 'ok' });
  const page = await fetch('http://127.0.0.1:3101/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>DocScout<\/title>/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)];
  assert.ok(assets.length >= 2, 'Production HTML must reference built JS and CSS');
  for (const [, asset] of assets) {
    assert.equal((await fetch(`http://127.0.0.1:3101${asset}`)).status, 200);
  }
  assert.equal((await fetch('http://127.0.0.1:3101/api/unknown')).status, 404);
  console.log('Production smoke passed: health, frontend, built assets, API 404.');
} finally {
  server.kill();
}
