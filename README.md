# DocScout

DocScout helps people find possible contribution tasks in public GitHub repositories. It reads a bounded set of repository documents and maintainer-labeled open issues, then reports suggestions with the evidence and coverage behind them.

The guiding rule is **evidence first**: a suggestion is limited to what DocScout actually checked. Incomplete or skipped checks stay visible as partial or unknown; an empty result means no suggestions were found in the checked scope, not that the repository has no problems.

## Current MVP

The core MVP (Phases 0–4) is implemented. For one public `github.com` repository, DocScout:

- resolves the default branch to a commit and uses that pinned snapshot for repository files;
- reads one supported root README, one selected repository-local `CONTRIBUTING.md` when found, the root `package.json`, and up to 12 additional Markdown files under `docs/`;
- checks selected Markdown for missing repository-relative file targets, and conservatively checks supported README npm commands against scripts in the root `package.json`;
- retrieves open issues carrying `good first issue` or `help wanted` labels and presents them as possible opportunities;
- shows source evidence, confidence, next steps, and coverage, including partial results when limits or unavailable evidence prevent a complete check. Every finding is a suggestion that needs human verification, not a confirmed defect.

Issue data is fetched from GitHub when a scan runs, so it can change independently of the pinned file snapshot. Labels do not prove that an issue is easy, still available, or a good fit; verify it on GitHub before acting.

Phase 5 AI remains optional, intentionally disabled, and unimplemented; the core MVP does not depend on it. Phase 6C real-repository validation and the Phase 6D release-documentation audit are complete. Phase 6E final verification is the remaining Phase 6 gate.

## Prerequisites

- Node.js `^22.12.0 || ^24.0.0` as recorded in the root `package.json` (Node 22.12 or later on the 22 line, or Node 24.x).
- npm, included with Node.js.
- Git, to clone the repository.

## Fresh installation

```sh
git clone https://github.com/SheikhAbdullahNasir/docscout.git
cd docscout
npm ci
```

The repository uses npm workspaces and commits `package-lock.json`; `npm ci` installs the locked dependencies. No GitHub token, AI key, login, or database is needed for anonymous local use.

## Run in development

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the web app and proxies `/api` to the Node server at `http://127.0.0.1:3001`. Both development processes bind to loopback. The health endpoint at <http://127.0.0.1:3001/api/health> returns only `{"status":"ok"}`. Stop both processes with Ctrl+C.

### Optional GitHub token

Anonymous public GitHub API access is enough to use DocScout. GitHub's anonymous rate allowance is limited and shared by the originating IP, so repeated scans may be throttled. A token can raise the available API allowance, but it does not make scans unlimited.

To use one, copy `.env.example` to a root `.env` file and set `GITHUB_TOKEN` there. The server reads it for GitHub requests; it is never sent to the browser. Use a least-privilege token and keep `.env` private: it is ignored by Git. Never put a secret in a `VITE_` variable or paste it into chat. A token does not enable access to private repositories; DocScout rejects private repositories regardless.

`TRUSTED_PROXY` is blank by default. Set it only when deployment uses a reverse proxy, and then list that proxy's explicit IP address or CIDR values. Do not use a wildcard or trust arbitrary forwarded headers. The supported server settings and blank credential placeholders are in `.env.example`.

## What DocScout does not check

- Only public repositories on `github.com` and the default branch are in scope. Private repositories, other Git hosting services, other branches, and full history are not supported.
- Local-link analysis checks repository-relative file targets. External URLs and heading anchors are not checked. Generated documentation or site-router paths may produce a missing-path suggestion even when intentional; check the project's site configuration before proposing a change.
- npm-script analysis recognizes only conservative README command forms and compares them with scripts in the root `package.json`. It does not execute commands or resolve scripts in nested packages or workspaces.
- The docs selector reads at most 12 additional Markdown files under `docs/`. Issue retrieval is limited to two pages per supported label; findings are capped at 50 documentation suggestions and 20 labeled issues. The browser response is capped at 3 MiB; omitted evidence can make coverage partial.
- Incomplete or skipped checks remain visible as partial or unknown. An empty scan means no suggestions were found in the checked scope, not that the repository has no problems. DocScout does not estimate issue difficulty, create issues or pull requests, or write to analyzed repositories.

## Security and privacy

Treat repository documents and issue text as untrusted input. DocScout sends bounded read requests to GitHub's API; it does not fetch arbitrary URLs found in repository content. It never clones a repository, installs its dependencies, builds it, or runs its code. Repository content is displayed safely, and remote images are not loaded automatically.

DocScout only accepts public repositories and performs no GitHub writes. The optional GitHub token stays on the server. AI settings in `.env.example` are placeholders: AI is not implemented, no AI requests are made, and setting provider keys does not enable it.

The MVP has no database, persistent scan history, or analytics tracking. Scan coordination, rate limits, and result caching are held in server memory; cache entries expire and restart clears that state. Limits are per server process, so a multi-instance deployment would need shared coordination.

## Verification commands

Run the checks from the repository root:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:production
```

The automated tests use local fixtures and do not require a GitHub token or AI key. For browser tests, install Chromium once and then run:

```sh
npm exec -- playwright install chromium
npm run test:e2e
```

## Production build and local start

```sh
npm run build
npm start
```

Open <http://127.0.0.1:3001>. The server serves the built frontend and API from the same origin; `PORT` can select another port. The current server binds to loopback, so this is a local production-mode check, not a public deployment. No public deployment has been performed as part of this project. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deployment constraints and production smoke steps.

## Project and release documentation

- [`PROJECT_SPEC.md`](PROJECT_SPEC.md) is the product and safety source of truth.
- [`PROGRESS.md`](PROGRESS.md) records phase status, decisions, and verification evidence.
- [`docs/VALIDATION.md`](docs/VALIDATION.md) records the real-repository validation evidence and its limitations.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) documents the production startup path, deployment constraints, security boundaries, and smoke procedure.

## Release validation sample

The Phase 6C review covered six public repositories across JavaScript/TypeScript, Rust, Go, and Python. All 50 documentation findings returned in the sample came from Vitest and were classified as intentional, generated, or project-route behavior explained by its VitePress setup; 14 additional findings omitted by the cap were not inspected. None was classified as supported/useful; this small manual review is not a benchmark. See [`docs/VALIDATION.md`](docs/VALIDATION.md) for the full evidence.

The core MVP is implemented through Phase 4. Phase 5 remains optional and disabled. Do not treat a successful local build as a public release or deployment.
