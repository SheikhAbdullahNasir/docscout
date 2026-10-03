# DocScout progress

Approved source: `PROJECT_SPEC.md` version 1.0. Updated October 3, 2026.

## Phase status

- [x] Phase 0 — local workspace, scripts, blank environment example, basic URL form, health endpoint; acceptance gate passed.
- [ ] Phase 1 — GitHub foundation and independent server URL validation.
  - [x] Phase 1A — strict server URL validation and public repository metadata only.
  - [ ] Remaining Phase 1 — pinned commit/tree/files, guidance, labeled issues, and browser integration.
- [ ] Phase 2 — evidence-backed core analyzers.
- [ ] Phase 3 — usable results and complete UI states.
- [ ] Phase 4 — reliable core, security limits, fixtures, and CI.
- [ ] Phase 5 — optional AI; not requested, disabled.
- [ ] Phase 6 — release readiness and real-repository validation.

## Phase 0 decisions and completed work

- Preserved the original `PROJECT_SPEC.md`; no preexisting application files or Git history existed locally. GitHub origin had no advertised refs at initial inspection.
- Initialized Git on `main`; origin is `https://github.com/SheikhAbdullahNasir/docscout.git`.
- Added `.gitignore` before staging: environment secrets, dependency folders, builds, coverage, browser artifacts, temporary files, and private key files excluded. `.env.example` stays trackable with blank credentials.
- Used npm workspaces: React/TypeScript/Vite frontend, Node/TypeScript/Express server, shared types. Committed lockfile records exact dependency versions.
- Environment verified: Node 22.19.0, npm 10.9.3, Git 2.55.0.windows.3. Node 22.12+ on the supported 22 line or Node 24 is required.
- Added accessible URL form with basic browser shape validation and explicit Phase 1 notice. No scan is performed.
- `GET /api/health` returns only `{"status":"ok"}`. Analysis and explanation endpoints remain unavailable.
- Vite proxies `/api` during development; production server serves frontend and API together. Both bind to loopback.
- AI is disabled with no AI runtime SDK, request path, or controls. No GitHub repository ingestion, analytics, or public deployment.
- README documents fresh setup, checks, production-mode local startup, and future phase commit/push workflow.

## Verification evidence

Run on October 2, 2026 after `npm ci`:

| Check | Result |
|---|---|
| Clean lockfile install, `npm ci` | Passed; 266 packages added, 270 audited, zero reported vulnerabilities |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed for all three workspaces |
| `npm test` | Passed: 2 API tests, including health secrecy and absent scan/AI routes |
| `npm run build` | Passed: frontend assets and compiled server |
| `npm run test:production` | Passed: local health, HTML, JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: 3 Chromium tests for health proxy, keyboard form/validation, local-only requests, 360/1280 widths |
| Ignore rules and source credential-pattern review | Passed; no credential-pattern matches in reviewed application/configuration files |

Browser installation initially hit download timeouts; retry completed successfully before reporting the browser gate passed. Playwright emitted environment color warnings; they did not fail tests. Git commands used a folder-scoped safe.directory option because the Windows sandbox account differs from the folder owner. No global trust changes were made. GitHub CLI is absent, but Git Credential Manager authenticated the successful push; no credential setup is blocked.

## Commit and push record

Staged file list and source diff reviewed; no dependency directories, generated builds, browser artifacts, or real credentials staged. Independent review found no Phase 0 blockers. Fixed a minor environment-location issue so source/compiled layout determines the root `.env` path independently of `NODE_ENV`, then reran affected checks.

Phase 0 implementation commit: `45c3258` — `feat: complete DocScout phase 0 setup`. Successfully pushed to `origin/main` on October 2, 2026; local main tracks origin/main. No force push or remote history replacement. A documentation follow-up records this outcome. Future blocked pushes must be reported honestly; never request credentials in chat.

## Phase 1A — metadata foundation (October 3, 2026)

Implemented only the requested first foundation slice:

- Raw repository URL validation normalizes whitespace, optional trailing slash and `.git` into separate validated owner/repo values. Rejects unsupported hosts/schemes, credentials, explicit ports (including 443), query/fragment, extra/empty/dot segments, control characters, backslashes, and all percent encoding. Conservative owner/repository character and length checks avoid path interpretation changes.
- Server GitHub client constructs only `https://api.github.com/repos/{owner}/{repo}` with encoded validated segments. Sends the required Accept, User-Agent, and `2026-03-10` API-version headers; optional token is read from server configuration only. Supported API version and metadata endpoint were rechecked in official GitHub documentation.
- Canonical owner/name/URL, strict public flag, archived flag, and default branch are validated at runtime and returned as small shared TypeScript types. Private metadata is rejected regardless of token. Extra upstream fields are discarded; the canonical URL must match the validated canonical identity.
- `POST /api/repository` accepts `{ repositoryUrl }` and returns `{ schemaVersion: 1, repository }`. This is a metadata-only foundation endpoint, not a completed scan. Browser form, health endpoint, and unavailable `/api/analyze`/`/api/explain` behavior remain intact.
- Safe typed errors with request IDs cover invalid/malformed/oversized input, 404, private repository, 401, permission 403, rate-limit 403/429, malformed metadata, redirects, timeout, and network/upstream failures. Tokens, raw upstream messages, and stack traces are not serialized or logged.
- No new dependencies. Native fetch accepts an injected fake transport for offline tests. Request JSON is capped at 4 KiB, upstream data at 2 MiB while streaming, and the request at 10 seconds. No redirects or retries in this slice; moved repository URLs must be updated by the caller. Queueing, caching, and wider reliability work are deferred.

### Phase 1A checks

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed after fixing two initial lint findings |
| `npm run typecheck` | Passed in all workspaces |
| `npm test` | Passed: 93 tests across 4 suites (91 new, 2 existing) |
| `npm run build` | Passed for frontend and compiled server |
| `npm run test:production` | Passed: health, HTML, JS/CSS assets, API 404 |
| `npm run test:e2e` | Passed: all 3 existing Phase 0 browser checks |
| One manual anonymous metadata smoke | Passed using built client: octocat/Hello-World, public, not archived, default branch `master` |

Tests use fake Responses/transports only: URL matrix; headers/token presence/absence; canonical identity and non-main branch; private/malformed metadata; 401/403/404/429/5xx; cooldown headers and secondary-limit messages; redirect refusal; network/timeout errors; body cap and malformed JSON; API serialization and no outbound call on invalid input. New suites failed for missing modules before implementation. Initial lint found control-regex and unused middleware-argument violations; both resolved and full checks rerun. Playwright only emitted harmless color-environment warnings. No unresolved implementation or verification blocker.

Independent review found no blockers. Its minor parser-error finding was reproduced with two failing tests: unsupported JSON charset/encoding returned 502. Mapped these cases to safe 415 input errors, verified both tests pass, and reran lint/typecheck/tests/build/production smoke. Git review/commit/push for this slice is the final bookkeeping step; preserve main history, never force-push. The browser intentionally retains its setup preview until the remaining Phase 1 flow can produce real results.

## Remaining work

Stop after Phase 1A. Next intended step: use canonical public metadata to resolve `default_branch` to its commit SHA and tree SHA, with offline fixtures for slash-containing branch names and empty repositories. Do not fetch commits/trees/files/issues in this task. README/guidance/issues and browser result wiring remain future Phase 1 steps; analyzers, result UI, full reliability budgets, queue/cache/retries, CI, and Phase 6 reports remain deferred. AI stays disabled; no live scan, billable AI call, cloning, repository code execution, or public deployment was performed. Continue to update progress, run relevant checks, and commit/push after each authorized completed slice.
