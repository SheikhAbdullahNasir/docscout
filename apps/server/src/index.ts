import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';

const isCompiled = import.meta.url.includes('/dist/');
process.env.NODE_ENV ??= isCompiled ? 'production' : 'development';

// Load only the root server environment, never a browser-prefixed credential.
const envPath = isCompiled
  ? new URL('../../../../../../.env', import.meta.url)
  : new URL('../../../.env', import.meta.url);
dotenv.config({ path: fileURLToPath(envPath), quiet: true });

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535.');
}

const host = process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1';
const server = createApp().listen(port, host, () => {
  console.log(`DocScout server: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
