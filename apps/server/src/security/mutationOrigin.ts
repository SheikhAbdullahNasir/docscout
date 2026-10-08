import type { Request } from 'express';

const DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function normalizedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Origin is optional for non-browser clients; present values must match the request or the narrow Vite dev origin. */
export function isAllowedMutationOrigin(req: Request, origin: string, development = process.env.NODE_ENV === 'development') {
  const supplied = normalizedOrigin(origin);
  if (!supplied) return false;

  const host = req.get('host');
  if (host) {
    const requestOrigin = normalizedOrigin(`${req.protocol}://${host}`);
    if (requestOrigin === supplied) return true;
  }

  return development && DEVELOPMENT_ORIGINS.has(supplied);
}
