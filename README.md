# DocScout

DocScout is a local tool being built to help new contributors find evidence-backed tasks in public GitHub repositories. `PROJECT_SPEC.md` is the approved specification. Only Phase 0 is implemented.

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

The form accepts a basic GitHub repository URL shape, supports Enter submission, and shows inline errors. Submitting a valid shape displays a Phase 1 notice. It sends no scan request. Full server URL validation, GitHub reads, results, and analyzers are future phases. AI has no implementation or runtime SDK and remains disabled regardless of environment keys. There is no public deployment.

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
