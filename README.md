# DocScout

DocScout is a local tool being built to help new contributors find evidence-backed tasks in public GitHub repositories. `PROJECT_SPEC.md` is the approved specification. Phase 0 and GitHub foundation Phases 1A–1D are implemented; Phase 1 as a whole is incomplete.

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

The form accepts a basic GitHub repository URL shape, supports Enter submission, and shows inline errors. Submitting a valid shape displays a Phase 1 notice. It sends no scan request. The server metadata and snapshot endpoints described below are available separately. Browser scan results and analyzers are future steps. AI has no implementation or runtime SDK and remains disabled regardless of environment keys. There is no public deployment.

## Phase 1A metadata endpoint

`POST /api/repository` accepts JSON `{ "repositoryUrl": "https://github.com/owner/repo" }` with a maximum body size of 4 KiB. Surrounding whitespace, trailing `/`, and `.git` are supported. Ports (including explicit 443), credentials, query/fragment, extra segments, encoded characters, and non-GitHub HTTPS URLs are rejected before any outbound call.

The server makes one bounded `GET https://api.github.com/repos/{owner}/{repo}` request. A successful response is `{ schemaVersion: 1, repository: { owner, name, url, private: false, archived, defaultBranch } }`. Identity is canonical GitHub metadata, not the pasted URL. `defaultBranch` can contain slashes and is not assumed to be `main`.

Anonymous requests need no credentials. An optional root `.env` `GITHUB_TOKEN` is used only by the server; private repositories are rejected even with a token. Headers use the spec's pinned API version `2026-03-10`, confirmed against [GitHub API version documentation](https://docs.github.com/en/rest/about-the-rest-api/api-versions).

Errors return `{ error: { code, message, retryAt? }, requestId }`. Invalid input is 400, oversized JSON is 413, unsupported charset/encoding is 415, unavailable/private repository is 404, credential/permission/network/upstream errors are 502, and GitHub cooldown is 503. Upstream bodies, tokens, and stack traces are never returned. Cooldown timing is included when valid headers provide it.

This slice uses a 10-second request timeout and 2 MiB streamed response cap, without retries, caching, or queueing. All redirects are rejected, including moved repositories; use their current canonical URL. `/api/analyze` and `/api/explain` remain unavailable. Automated tests inject fake GitHub responses and never call the live API.

## Phase 1B snapshot endpoint

`POST /api/repository/snapshot` accepts the same `{ repositoryUrl }` JSON and first fetches public canonical metadata. It resolves the actual default branch through the [commit endpoint](https://docs.github.com/en/rest/commits/commits#get-a-commit), encoding the entire branch as one parameter (including `/`). It fetches the [recursive Git tree](https://docs.github.com/en/rest/git/trees#get-a-tree) using the commit's exact tree SHA.

Returns `{ schemaVersion: 1, repository, status: "ready", snapshot: { defaultBranch, commitSha, treeSha, tree, documents } }`. Tree entries retain `path`, `type`, `mode`, `sha`, and optional `size`; response URLs and other fields are discarded. Path case stays exact. `truncated: true` always means `complete: false`; absent paths in that response cannot prove a file is missing. No missing-path analysis is implemented.

When GitHub confirms an empty repository via a commit 409 and its known empty-repository message, the endpoint returns HTTP 200 with metadata, `status: "empty"`, `snapshot: null`, and a readable message. Other commit failures (including an unavailable branch 404 or an unrelated 409) return safe errors, rather than falsely claiming emptiness. Tree lookup failure is also a safe error with no usable coverage claim. Existing auth/cooldown handling applies at each stage.

The metadata/commit/tree foundation makes three requests, followed by at most 15 selected-content requests and at most four issue-page requests. There are no retries or response URL redirects. The tree has a 10 MiB streamed input cap; other GitHub JSON responses retain 2 MiB. Each request has a 10-second timeout. Snapshot JSON exceeding the spec's 3 MiB browser-response cap is rejected with a readable error, never silently truncated and marked complete. Queue/cache and full scan reliability remain later steps.

## Phase 1C selected documents

The snapshot uses its returned tree to select one supported root Markdown README, repository-local `CONTRIBUTING.md` using root → `.github/` → `docs/` precedence, exact root `package.json`, and up to 12 sorted Markdown files below `docs/`. Exact repository path casing is retained. Selected symlinks and submodules are skipped, and selected contribution guidance is not duplicated in the additional docs list.

Every selected ordinary file is requested only through `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={commitSha}`. Path segments and the commit ref are encoded; moving branch names, `download_url`, repository-provided URLs, and document links are never fetched. Evidence links use `github.com/{owner}/{repo}/blob/{commitSha}/{path}` so they remain pinned to the scanned commit.

Contents responses must be a matching Base64 file object. Decoded UTF-8 is limited to 256 KiB per file and 2 MiB combined. Malformed Base64/JSON, invalid UTF-8, binary text, Git LFS pointers, oversized files, and individual unavailable optional files become typed skips while other usable documents remain. Authentication, permission, and cooldown errors remain request failures. Missing optional files are explicit; when the tree is truncated, absent selections are `unknown` and `documents.selectionComplete` is false because unseen paths could change precedence or ordering.

Analyzers, browser result integration, and repository-content execution are not part of Phase 1C.

## Phase 1D labeled issues

The snapshot response now includes `issues: { fetchedAt, items, coverage }`. The server requests open `good first issue` and `help wanted` streams separately, sorted by most recently updated with 100 items per page. It follows only validated `https://api.github.com` pagination for the same repository/query and fetches at most two pages per label. If another page remains, coverage reports that issue results were sampled.

Pull requests returned by GitHub's Issues endpoint are discarded. Issues appearing in both streams are deduplicated by number while preserving their exact label names, title, validated GitHub issue URL, update time, assignee logins, assignment state, and a plain-text body excerpt capped at 500 Unicode characters. The retrieval layer does not rank issues, estimate difficulty, or treat `help wanted` as proof that an issue is beginner-easy.

Each label query reports complete, partial, or failed coverage with pages fetched and cap state. Empty successful queries use the narrow message `No matches were returned for the supported label query.` Nonfatal upstream or malformed data can leave explicit partial coverage when the other label remains trustworthy. Authentication, permission, and cooldown failures remain fatal rather than appearing as empty results. Archived repository state remains in canonical metadata; issue data does not imply active maintenance.

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
