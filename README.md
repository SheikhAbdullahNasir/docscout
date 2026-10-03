# DocScout

DocScout is a local tool being built to help new contributors find evidence-backed tasks in public GitHub repositories. `PROJECT_SPEC.md` is the approved specification. Phase 0 and the metadata-only Phase 1A foundation are implemented; Phase 1 as a whole is incomplete.

## Prerequisites

- Node.js 22.12+ on the 22 LTS line, or Node.js 24 LTS, with npm. Verified here with Node 22.19.0 and npm 10.9.3.
- Git. Verified here with Git 2.55.0.windows.3.

The selected Vite version supports this Node floor: [Vite guide](https://vite.dev/guide/). Use a supported LTS line: [Node release schedule](https://github.com/nodejs/Release).

## Start locally

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The server runs at http://127.0.0.1:3001; Vite proxies `/api` to it. `GET /api/health` returns only `{"status":"ok"}`. Both processes bind to loopback. Stop with Ctrl+C.

No credentials or `.env` file are needed. Optional later server settings are documented in `.env.example`; credentials are blank. If you copy it to root `.env`, keep that file private. Do not put secrets in `VITE_` variables or paste credentials into chat. Development expects server port 3001 because the Vite proxy uses it.

The form accepts a basic GitHub repository URL shape, supports Enter submission, and shows inline errors. Submitting a valid shape displays a Phase 1 notice. It sends no scan request. The server metadata endpoint described below is available separately. Snapshot/file/issue reads, scan results, and analyzers are future steps. AI has no implementation or runtime SDK and remains disabled regardless of environment keys. There is no public deployment.

## Phase 1A metadata endpoint

`POST /api/repository` accepts JSON `{ "repositoryUrl": "https://github.com/owner/repo" }` with a maximum body size of 4 KiB. Surrounding whitespace, trailing `/`, and `.git` are supported. Ports (including explicit 443), credentials, query/fragment, extra segments, encoded characters, and non-GitHub HTTPS URLs are rejected before any outbound call.

The server makes one bounded `GET https://api.github.com/repos/{owner}/{repo}` request. A successful response is `{ schemaVersion: 1, repository: { owner, name, url, private: false, archived, defaultBranch } }`. Identity is canonical GitHub metadata, not the pasted URL. `defaultBranch` can contain slashes and is not assumed to be `main`.

Anonymous requests need no credentials. An optional root `.env` `GITHUB_TOKEN` is used only by the server; private repositories are rejected even with a token. Headers use the spec's pinned API version `2026-03-10`, confirmed against [GitHub API version documentation](https://docs.github.com/en/rest/about-the-rest-api/api-versions).

Errors return `{ error: { code, message, retryAt? }, requestId }`. Invalid input is 400, oversized JSON is 413, unsupported charset/encoding is 415, unavailable/private repository is 404, credential/permission/network/upstream errors are 502, and GitHub cooldown is 503. Upstream bodies, tokens, and stack traces are never returned. Cooldown timing is included when valid headers provide it.

This slice uses a 10-second request timeout and 2 MiB streamed response cap, without retries, caching, or queueing. All redirects are rejected, including moved repositories; use their current canonical URL. `/api/analyze` and `/api/explain` remain unavailable. Automated tests inject fake GitHub responses and never call the live API.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm exec playwright install chromium
npm run test:e2e
npm run build
npm run test:production
```

Playwright needs a one-time Chromium download. API and browser tests use local data and require no GitHub token or AI key. Keep ports 3001, 5173, and 3101 free for checks. The production smoke test uses 3101 and stops its child server afterward.

## Run the production build locally

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. The compiled server defaults to production mode and serves the built frontend and API from the same origin. A root `.env` can override `PORT`. This is a local check, not a deployment.

## Project layout and Git workflow

`apps/web` contains the React form; `apps/server` contains Express and startup; `packages/shared` contains shared types. `PROGRESS.md` records phase gates and blockers. Dependency versions are pinned by `package-lock.json`.

After every authorized future phase: update `PROGRESS.md`, run relevant checks, inspect the staged diff for secrets and generated files, commit the phase, and push to origin. Preserve remote history and never force-push. The only GitHub writes authorized by the setup request are this project's commits; the future scanner must never write to analyzed repositories.
