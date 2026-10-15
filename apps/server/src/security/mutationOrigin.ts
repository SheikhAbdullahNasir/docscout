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

function isRailwayPublicOrigin(req: Request, supplied: string) {
  if (!process.env.RAILWAY_SERVICE_ID) return false;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const host = req.get('host');
  if (!domain || !host) return false;

  const expectedOrigin = normalizedOrigin(`https://${domain}`);
  const requestHostOrigin = normalizedOrigin(`https://${host}`);
  return expectedOrigin !== undefined && requestHostOrigin === expectedOrigin && supplied === expectedOrigin;
}

/** Origin is optional for non-browser clients; present values must match the request or the narrow Vite dev origin. */
export function isAllowedMutationOrigin(req: Request, origin: string, development = process.env.NODE_ENV === 'development') {
  const supplied = normalizedOrigin(origin);
  if (!supplied) return false;

  if (isRailwayPublicOrigin(req, supplied)) return true;

  const host = req.get('host');
  if (host) {
    const requestOrigin = normalizedOrigin(`${req.protocol}://${host}`);
    if (requestOrigin === supplied) return true;
  }

  return development && DEVELOPMENT_ORIGINS.has(supplied);
}
