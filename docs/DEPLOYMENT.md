# DocScout production deployment guide

This guide describes the production path implemented in this repository. It prepares an owner to run DocScout; publishing or deploying it is a separate, explicit owner action and is not part of Phase 6B.

## Requirements and commands

Use a Node.js version accepted by the root `package.json` engine: `^22.12.0 || ^24.0.0` (Node 22.12 or newer in the 22 line, or Node 24). Run commands from the repository root. `package-lock.json` is committed, so install its exact dependency tree with `npm ci`.

```sh
npm ci
npm run build
npm start
```

`npm run build` builds the Vite frontend and compiles the Node server. `npm start` runs the compiled server; it does not start Vite or build the project. Build again after changing source files.

## Runtime configuration and secrets

The server reads environment variables and an optional root `.env` file. `.env.example` lists the supported settings. Keep real secrets in the server environment or the untracked root `.env` file:

| Setting | Behavior |
|---|---|
| `PORT` | Integer from 1 through 65535; defaults to `3001`. |
| `TRUSTED_PROXY` | Optional comma-separated explicit IP addresses or CIDRs for the reverse proxy; see below. |
| `GITHUB_TOKEN` | Optional server-side token for public GitHub API reads. Anonymous use needs no token; a token improves the upstream allowance but does not make it unlimited or allow private repositories. |
| `AI_PROVIDER` | Keep `none`. AI is not implemented, makes no requests, and has no runtime key requirement. |

Never put a secret in a `VITE_` variable. Vite variables with that prefix are exposed to browser code in the built frontend. `GITHUB_TOKEN` is read by the Node server and is never sent to the browser. The OpenAI and Gemini entries in `.env.example` are placeholders for a future phase and do not enable AI.

## Production serving and network layout

In production, the Node server serves both the built frontend and `/api` from the same origin. The browser therefore sends API requests back to the origin that served the page. A static-only hosting service cannot run DocScout by itself because it cannot run the required Node API server.

The server currently listens on `127.0.0.1:<PORT>`; there is no configurable bind-host setting, and the app does not terminate TLS. For a real deployment, use HTTPS at an ingress or reverse proxy that runs in the same host/network namespace and can forward requests to that loopback listener. Confirm that the chosen runtime can reach the loopback-bound process before adopting it; a platform that can route only to an externally bound application port cannot reach this server as currently configured. Keep the frontend and `/api` on the same public origin.

HTTPS is expected for real deployments. Terminate TLS at the HTTPS ingress/reverse proxy and forward to the local Node listener. Local smoke checks use plain HTTP on loopback.

### Trusted proxy configuration

Express proxy trust is disabled when `TRUSTED_PROXY` is blank. When a reverse proxy is in front of DocScout, set `TRUSTED_PROXY` to the proxy's actual source IP address or CIDR values, comma-separated. For a proxy that connects from IPv4 loopback, for example, `127.0.0.1/32` may be appropriate; use the address the server actually sees.

This setting must be explicit and narrow. DocScout uses Express's client IP for its per-IP scan admission limit. Trusting arbitrary forwarded headers, a wildcard, or every address would let clients spoof their IP and weaken that limit. If the proxy is not trusted, Express sees the proxy address as the client and users behind it may share one admission bucket. The server rejects invalid values and CIDRs that trust every address.

## Runtime limits and scaling

The current limits protect one server process and bound each scan:

- A scan has a 60-second deadline, including time waiting for the GitHub request queue. Each GitHub request has a 10-second timeout, and a scan can dispatch at most 30 GitHub requests.
- Configure the deployment ingress/request timeout to allow the full 60-second scan budget plus response delivery; a shorter timeout can close the request before DocScout returns its result.
- Snapshot request JSON is limited to 4 KiB. GitHub JSON responses are limited to 2 MiB, except recursive tree responses, which are limited to 10 MiB. Selected repository documents are limited to 256 KiB each and 2 MiB combined; the browser response is bounded to 3 MiB.
- The server admits at most 5 snapshot requests per client IP in a rolling 10-minute window, and at most 10 distinct scans may be pending at once. Identical in-flight scans share work.
- A process-wide queue serializes GitHub requests. Completed scan results are cached in process memory for up to 10 minutes, with a maximum of 50 entries and 32 MiB.

The queue, cache, pending-scan admission, and rate-limit state are all per process. Restarts clear this state, and multiple instances maintain separate queues, caches, and limits. Begin with one server instance. Before horizontal scaling, add shared coordination for request serialization/admission, in-flight work, caching, and per-client rate limits; otherwise each instance applies a separate set of limits and cache state. GitHub's own anonymous and authenticated quotas are upstream limits shared according to GitHub's policies, not guaranteed scan capacity.

## Security and data boundaries

Analyzed repositories, documentation, and issue text are untrusted. DocScout reads selected public repository data from GitHub's API and does not clone repositories, install their dependencies, import or build their code, or execute their commands. It performs GitHub reads only; it does not create issues or pull requests or write to analyzed repositories. Findings and coverage remain bounded by the limits above and still require human review.

## Production smoke check

From a clean checkout on a supported Node version, run the locked install and build, then the existing production smoke gate:

```sh
npm ci
npm run build
npm run test:production
```

The smoke script starts the compiled production server locally on `127.0.0.1:3101`, checks that `/api/health` returns `{"status":"ok"}`, verifies the built frontend and its JavaScript/CSS assets are served successfully, and checks that an unknown `/api` route returns 404. It stops the server when the check finishes.

For a manual run after building, use `npm start` and open `http://127.0.0.1:<PORT>/` (default port `3001`). Confirm `/api/health` returns `{"status":"ok"}`, the page and referenced assets load from the same origin, and an unknown `/api` route returns a safe JSON 404. Stop the server with Ctrl+C. This local procedure does not contact GitHub or publish the application.
