# DocScout progress

Approved source: `PROJECT_SPEC.md` version 1.0. Updated October 4, 2026.

## Phase status

- [x] Phase 0 — local workspace, scripts, blank environment example, basic URL form, health endpoint; acceptance gate passed.
- [x] Phase 1 — GitHub foundation, bounded snapshot data, and browser acceptance gate.
  - [x] Phase 1A — strict server URL validation and public repository metadata only.
  - [x] Phase 1B — default-branch commit snapshot and bounded recursive tree.
  - [x] Phase 1C — deterministic selected-document paths and bounded pinned content retrieval.
  - [x] Phase 1D — bounded open labeled-issue retrieval with explicit coverage.
  - [x] Phase 1E — minimal browser integration for repository metadata, pinned documents, labeled issues, and truthful states.
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

Independent review found no blockers. Its minor parser-error finding was reproduced with two failing tests: unsupported JSON charset/encoding returned 502. Mapped these cases to safe 415 input errors, verified both tests pass, and reran lint/typecheck/tests/build/production smoke. Staged source/files were reviewed for scope, whitespace, secrets, and generated artifacts. Implementation commit `3eb2d67` (`feat: add Phase 1A public repository metadata foundation`) was successfully pushed to origin/main on October 3, 2026, preserving history without force. A documentation follow-up records the outcome. The browser intentionally retains its setup preview until the remaining Phase 1 flow can produce real results.

## Phase 1B — pinned snapshot and tree (October 3, 2026)

- Extended the existing GitHubClient with getSnapshot(publicMetadata). One private bounded JSON request method now shares required headers, optional token, fixed host, redirect refusal, timeouts, and safe errors across metadata/commit/tree requests. No competing access layer or dependency changes.
- Revalidated canonical public metadata and branch syntax before lookup. Encoded the actual default branch as one ref parameter; no main/master assumption. Validated commit SHA and commit.tree.sha as exact 40-character hexadecimal Git object IDs, then requested only `/git/trees/{treeSha}?recursive=1`.
- Added typed tree entries with exact-case path, object type, Git mode, SHA, and optional size. Modes preserve enough information to distinguish regular/executable files, symlinks, directories, and submodules later. Unsafe/malformed/duplicate paths, invalid type/mode/size/SHA, mismatched returned tree SHA, or missing truncation flags fail closed. Response URLs and extra fields are never requested or retained.
- Added typed ready/empty snapshot results. `truncated: true` implies incomplete path coverage. No absence-based findings, file selection, file-content downloads, or issue requests are implemented.
- Added `/api/repository/snapshot` while preserving metadata-only `/api/repository`, health, setup form, and unavailable analyze/explain endpoints. Both use the existing JSON body limit and error middleware.
- Confirmed commit empty-repository 409 yields HTTP 200, metadata, status empty, and null snapshot, with no tree request. An unrelated conflict, branch 404, or malformed commit is a safe commit error; tree failures are safe tree errors. Inherited auth/cooldown/network errors remain available at both stages. Raw upstream error text is never exposed.
- Kept 10-second per-request timeout and 2 MiB other-response cap; used spec's 10 MiB streamed tree cap and 3 MiB snapshot response cap. Oversize output is rejected rather than silently cutting complete evidence. No queue/cache/retry/persistence layer added. Official commit/tree endpoint docs were rechecked.

### Phase 1B verification

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed |
| `npm run typecheck` | Passed across all workspaces |
| `npm test` | Passed: 143 tests across 6 suites; 50 new tests and all 93 previous tests |
| `npm run build` | Passed: frontend and server |
| `npm run test:production` | Passed: health, HTML, JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 3 existing browser regressions |
| Bounded anonymous live metadata → commit → tree | Passed: octocat/Hello-World, exactly 3 requests |

Live evidence: branch `master`; commit `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`; tree `b4eecafa9be2f2006ce1b709d6857b07069b4608`; 1 tree entry, truncated false, complete true. Used the compiled client, no token, no contents/issues calls. Live access is not part of automated tests.

Offline tests cover main/non-main/slash/special-character branches, canonical request order, headers and fixed targets, SHA extraction/validation, regular and truncated trees, exact case and modes, empty repositories, unrelated conflict/404 failures, commit/tree auth/permission/cooldown/network/redirect errors, malformed evidence, duplicate paths, streamed size limits, oversized output, private metadata, invalid request admission, and safe error serialization. Initial new tests failed because getSnapshot was missing. Follow-up checks caught a branch error classification mismatch and unnecessary regex escape; fixed both and reran all checks successfully. Existing Playwright color-environment warnings remain harmless.

Independent review found no blockers or important issues. No skipped or blocked verification. Implementation commit `3d4e6d6` (`feat: add Phase 1B pinned snapshot and recursive tree`) was successfully pushed to origin/main on October 3, 2026, preserving history without force. This documentation follow-up records the outcome; Phase 1 remains incomplete.

## Phase 1C — selected pinned documents (October 3, 2026)

- Extended the existing snapshot flow rather than adding another GitHub access layer. Selection uses the Phase 1B tree and retains exact repository paths and casing.
- Root README selection supports Markdown README filenames case-insensitively, prefers exact `README.md`, and otherwise uses a deterministic alphabetical fallback. Complete-tree absence is exactly `No supported root Markdown README found.`; incomplete-tree absence remains unknown.
- Repository-local `CONTRIBUTING.md` uses root → `.github/` → `docs/` precedence with case-insensitive filename matching. Only exact root `package.json` is selected. Up to 12 additional `.md` paths below exact `docs/` are selected in deterministic order, excluding selected contribution guidance.
- Ordinary `100644` and `100755` blobs are analyzable. Matching symlinks and submodules are skipped with typed reasons. Git LFS pointer content is also skipped. No repository content is executed, imported, installed, built, or used as a request target.
- Every selected file request is constructed from validated canonical identity and encoded path segments at fixed `https://api.github.com`, using `GET /repos/{owner}/{repo}/contents/{path}?ref={commitSha}`. Branch names, `download_url`, API-provided URLs, README links, and arbitrary repository-controlled URLs are never fetched.
- Contents API responses must be matching Base64 file objects. Decoding uses strict UTF-8, rejects malformed Base64/shape/path/SHA/size, invalid UTF-8, clearly binary text, and Git LFS pointers. Each decoded file is capped at 256 KiB and combined selected text at 2 MiB; retrieval stops and records omissions when the combined limit is reached.
- Typed documents retain category, actual path, blob SHA, reported and decoded byte sizes, bounded text, and a `github.com/.../blob/{commitSha}/...` evidence URL. Optional 404/5xx/redirect/network/malformed/oversized content failures become skips so other useful documents survive; authentication, permission, and cooldown failures remain scan errors.
- Existing tree `truncated`/`complete` evidence remains unchanged. `documents.selectionComplete` mirrors path coverage: observed paths can be used from a truncated tree, but selection explicitly remains incomplete because unseen paths could change README/CONTRIBUTING precedence or docs ordering.
- Updated README documentation for the expanded snapshot response, request budget, selected-content safety rules, and remaining scope. Issue retrieval, analyzers, browser result integration, queues/caches, AI, cloning, and repository-code execution remain unimplemented.

### Phase 1C verification

| Command/check | Actual result |
|---|---|
| `npm run lint` | Passed |
| `npm run typecheck` | Passed across all workspaces |
| `npm test` | Passed: 175 tests across 8 suites; all Phase 0/1A/1B regressions retained |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: 3 existing Chromium tests covering health proxy, keyboard form/validation, local-only requests, and 360/1280 widths |
| Bounded anonymous live metadata → commit → tree → selected content | Passed: `octocat/Spoon-Knife`, exactly 4 requests including one pinned Contents API request |

Live evidence: default branch `main`; commit `d0dd1f61b33d64e29d8bc1372a94ef6a2fee76a9`; tree `d7cee29eaada459ba458a63ad983a89915c6a10a`; 3 entries; tree not truncated; `documents.selectionComplete: true`; `README.md` fetched as 780 decoded UTF-8 bytes with source URL pinned to that commit. CONTRIBUTING, root `package.json`, and docs Markdown were absent and remained optional. An initial live check of `octocat/Hello-World` also verified complete-tree unsupported-README absence without attempting content retrieval. Live access is not part of automated tests.

Offline tests cover exact and differently-cased README selection, multiple candidates and fallback order, README absence, all CONTRIBUTING precedence levels and absence, root-only manifest behavior, sorted recursive docs selection and 12-file cap, non-Markdown/excluded guidance, exact casing, symlink/submodule skips, normal Base64 UTF-8, malformed/mismatched responses, per-file and exact combined-budget boundaries, binary and LFS content, optional missing/5xx/redirect/network/malformed/oversized responses, fatal auth/permission/cooldown errors, commit-pinned encoded requests and source URLs, and complete versus truncated selection coverage.

The initial sandboxed multi-suite Vitest runs hit transient Windows sandbox temporary-file errors, and Supertest could not bind loopback inside that sandbox. Re-running the unchanged suite with the required execution permission passed all 175 tests. Playwright again emitted harmless `NO_COLOR`/`FORCE_COLOR` warnings. No implementation or verification blocker remains.

Independent review initially identified incomplete-tree selection disclosure and stale README text. Added `documents.selectionComplete`, truncated fallback fixtures, the optional-failure matrix, and current README documentation. Follow-up review found no code regression or remaining Critical/Important implementation issue; only this required progress update remained.

Phase 1C implementation commit: `0c37f2d` (`feat: add Phase 1C pinned document retrieval`). The commit was created locally on `main`. A non-force push to the existing `origin/main` was attempted only after verification, but the execution approval gate rejected direct default-branch mutation because this request did not explicitly authorize that remote action. No workaround or alternate push was attempted. This documentation follow-up records the verified local checkpoint and the blocked push accurately.

## Phase 1D — bounded labeled issues (October 3, 2026)

- Extended the existing repository snapshot response with one shared typed `issues` result containing `fetchedAt`, deduplicated issue items, aggregate coverage, and per-label query coverage. Ready and empty repositories both retain issue coverage; canonical repository metadata, including `archived`, remains unchanged.
- Queried `good first issue` and `help wanted` separately through the existing fixed `https://api.github.com` client. Every request uses `state=open`, `sort=updated`, `direction=desc`, `per_page=100`, and one encoded supported label. No GitHub Search API, repository-controlled request URL, redirect, clone, execution, or GitHub write was added.
- Filtered every Issues endpoint object containing `pull_request`, merged both streams, and deduplicated by issue number. Typed records retain number, title, validated GitHub issue URL, exact label names, normalized `updated_at`, assignee logins, explicit assignment state, and a plain-text body excerpt bounded to 500 Unicode characters.
- Preserved label evidence without inference. This layer adds no ranking, difficulty estimate, time estimate, finding card, analyzer, or claim that `help wanted` is beginner-easy. Archived metadata is not converted into an active-maintenance claim.
- Followed only a single validated `https://api.github.com` next link per label for the same canonical repository and exact query. Each stream fetches at most two pages. A valid remaining page after page two is not fetched and sets `sampled: true`, `capped: true`, incomplete aggregate coverage, and an explicit sampling message.
- Successful empty streams use exactly `No matches were returned for the supported label query.` Partial or failed streams retain pages already validated and expose explicit coverage. Malformed issue data, invalid pagination, network failures, and upstream failures do not become empty results. If neither stream has usable coverage, the request fails safely.
- Authentication, permission, and GitHub cooldown errors remain fatal even after another label returned useful data. Existing safe error codes, optional token handling, required headers, streamed 2 MiB response cap, 10-second timeout, redirect refusal, and fixed-host construction are reused.
- Empty repositories still perform the two bounded label queries after GitHub confirms there is no commit, allowing trustworthy issue data alongside `snapshot: null`. A normal Phase 1D issue slice adds two to four requests, keeping the existing maximum snapshot flow below the specification's 30-request scan budget.
- Updated README documentation for the expanded response, request bounds, evidence fields, empty/partial semantics, and still-deferred work. Browser result integration remains unimplemented.

### Phase 1D verification

| Command/check | Actual result |
|---|---|
| Initial focused Phase 1D test run before implementation | Failed as expected: all 10 initial issue tests observed missing issue retrieval; the later malformed-timestamp regression also failed before strict validation |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed across all three workspaces |
| `npm test` | Passed: 187 tests across 9 suites; 12 new Phase 1D tests and all 175 previous tests |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 3 existing Chromium tests for the unchanged browser setup flow at 360/1280 widths |
| Bounded anonymous live metadata → commit → tree → issue streams | Passed against `octocat/Hello-World`: exactly 5 requests total and exactly 2 issue requests |
| Diff/secret review | Passed: scoped source/tests/docs only, no generated build output or credential pattern staged |

The live smoke resolved default branch `master`, returned a ready non-archived snapshot, and completed one page for each supported label. Both streams returned no matches and produced the narrow supported-query message; the check did not depend on any public repository having matching issues. Live access remains outside automated tests.

Offline tests cover separate label requests, both supported responses, exact query parameters, PR filtering, both-label deduplication, exact label retention, assigned/unassigned state, bounded excerpts, empty messages, empty-repository issue retrieval, validated second-page following, an available third page not fetched, cap/sampling disclosure, untrusted pagination-host rejection, malformed response and timestamp rejection, one-stream partial coverage, both-stream failure, and fatal issue authentication/rate-limit behavior. Existing snapshot/document/route fixtures were extended with deterministic empty issue pages so prior behavior remains exercised.

The first sandboxed full-suite run again encountered transient Windows sandbox temporary-file `ENOENT` failures and also exposed expected old-fixture assumptions about the two new issue requests. The fixture expectations were updated; the unchanged complete suite then passed outside that sandbox. Playwright emitted the existing harmless `NO_COLOR`/`FORCE_COLOR` warnings. No required check was skipped or remains blocked.

Phase 1D implementation commit: `1308abc` (`feat: add Phase 1D labeled issue retrieval`). No push or pull request was requested or attempted. This documentation follow-up records the verified local checkpoint.

## Phase 1E — browser acceptance-gate integration (October 4, 2026)

- Connected the existing Phase 0 form to the existing typed `POST /api/repository/snapshot` flow. No parallel endpoint, state-management framework, backend selection logic, analyzer, cache, queue, authentication, database, or worker was added.
- Added the minimal Phase 1 repository summary: canonical owner/name and link, default branch, archived notice, snapshot status, and compact pinned commit SHA.
- Added plain-text README and repository-local CONTRIBUTING previews with the selected backend path and pinned source link. Repository-provided HTML remains literal text; remote images and arbitrary text links are not rendered.
- Added straightforward labeled-issue source data: number/title/link, exact maintainer labels, update time, assignment state, assignees, and bounded body excerpt. No ranking, difficulty estimate, time estimate, opportunity card, or beginner-friendly claim was added.
- Added narrow complete-empty messages and distinct partial-empty behavior. Missing guidance is claimed only when selection evidence supports absence; unavailable or skipped selected guidance retains its narrower backend state.
- Added readable loading, completion, empty-repository, archived, unknown/unavailable document, incomplete path/selection, skipped document, sampled/failed issue stream, malformed-response, network, and safe server-error states. Server error messages are displayed without raw error objects, stack traces, tokens, or request internals.
- Added deterministic offline Playwright fixtures for successful scans, README, CONTRIBUTING, labeled issues, archived metadata, safe rendering, missing README/guidance, complete empty issue queries, partial coverage with zero returned records, skipped guidance, empty repositories with retained issues, invalid input, unavailable repositories, malformed success responses, and responsive layouts. Existing server/API tests remain unchanged and green.

### Phase 1E verification

| Command/check | Actual result |
|---|---|
| Initial focused Phase 1E browser test before implementation | Failed as expected: the old Phase 0 placeholder displayed “Repository scanning arrives in Phase 1” and sent no snapshot request |
| Truthfulness regressions before fixes | Failed as expected for unavailable/skipped CONTRIBUTING evidence and partial-empty issue coverage; each passed after its targeted fix |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed across all three workspaces |
| `npm test` | Passed: 187 tests across 9 suites; all Phase 0–1D tests retained |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: 11 Chromium tests, including 8 Phase 1E result/state tests and the 3 retained setup/responsive checks |
| Bounded public-repository browser smoke | Passed through the real browser form and API against `octocat/Spoon-Knife` |
| Diff/secret review | Passed: scoped browser source/tests/docs only; no generated build output or credential material staged |

The public smoke displayed canonical `octocat/Spoon-Knife`, default branch `main`, ready snapshot status, pinned commit `d0dd1f61b33d`, and the returned `README.md` as plain text. That repository returned no repository-local CONTRIBUTING guidance and no matches for the two supported issue-label queries, so the UI displayed the required narrow absence messages. The smoke did not require every optional resource. The in-app browser controller reset before opening the page, so the live smoke used a one-off local Chromium session through the same real form and server; the scan itself completed successfully. Automated tests remained offline.

Independent review found no Critical issues. It identified false-absence edge cases for unavailable/skipped guidance and empty partial issue coverage; those were fixed with red-to-green browser regressions. The review also prompted safe validation of successful response shapes, label-specific coverage notes, a completion announcement, and explicit empty-repository/unknown-document coverage.

Phase 1 acceptance gate: **passed** — “Fixture and public-repo smoke test display README/guidance/issues; absence/errors are readable.” Offline fixtures display available README, guidance, and issues; the public smoke displays the optional resources actually returned; absence, partial coverage, and representative errors are readable. Phase 1E implementation commit: `55a8762` (`feat: complete Phase 1 browser integration`). No push or pull request was requested or attempted.

## Phase 2A — repository-relative Markdown target analysis (October 4, 2026)

- Added one pure deterministic analyzer over already-fetched Phase 1 evidence. It accepts selected available Markdown documents plus the pinned recursive tree and performs no GitHub calls, URL fetches, filesystem reads, repository execution, or writes.
- Added `remark-parse`/`unified` AST parsing with retained source lines. Ordinary inline links and resolved reference-style links are checked; fenced and inline code are not interpreted as links. Undefined full/collapsed references are recovered from AST-bounded source ranges and reported unchecked rather than treated as missing.
- Resolves ordinary targets from the source document directory and leading-slash targets from repository root using POSIX semantics only. Query and fragment components are removed before lookup, safe URL decoding occurs exactly once, path segments are normalized, and exact Git-tree case is preserved. Known tree directories and the repository root count as existing targets.
- Rejects root escape, backslashes, NUL/C0/DEL controls, encoded separators, invalid/double-suspicious encodings, and destinations that decode into URI schemes. These remain unsupported and cannot produce missing-target findings. HTTP(S), protocol-relative, mail, pure-anchor, other-scheme, and image targets are also unsupported; no external URL is fetched.
- A relative path plus fragment checks only the repository path. Its heading anchor is separately recorded as unchecked. Query behavior is not interpreted. Explanatory limitations require manual verification of generated documentation, site/router paths, build-time behavior, and other project conventions.
- Missing-target findings require `tree.complete: true`. Incomplete trees can confirm observed existing targets but absence becomes unchecked and can never emit a finding. Findings are deduplicated by type + source path + normalized target, use stable SHA-256-derived IDs, retain pinned source URL/line/bounded evidence/original and normalized targets, and use only high-confidence snapshot-absence wording with difficulty `unknown`.
- Coverage records documents analyzed/unchecked, supported file targets checked, unchecked links and reasons, unsupported links and categories, findings produced, and findings omitted. Findings are capped at 50 with explicit omissions. Documents with more than 1,000 potential link openers are left unchecked before synchronous AST parsing, with typed coverage and a limitation, so pathological untrusted Markdown cannot block the server through link-dense parsing.
- Attached the typed analysis result to ready snapshot responses. Empty repositories retain their existing null snapshot behavior. The browser does not present findings in Phase 2A, but its runtime response guard validates the new analysis contract. No Phase 3 result-card or filter work was added.
- Updated Playwright startup orchestration to wait independently for a built backend health endpoint and Vite. This fixes a reproducible proxy race exposed by the larger server module graph; the shipped compiled server is now exercised by E2E setup.

### Supported and intentionally unchecked categories

- Checked: ordinary inline Markdown links and resolved full/collapsed/shortcut reference links whose destinations are safe repository-relative paths.
- Unchecked: supported relative targets absent from an incomplete tree, heading-anchor portions after a checked file path, unresolved explicit full/collapsed references, and documents skipped by the parser-safety admission bound.
- Unsupported: images, HTTP(S), protocol-relative URLs, `mailto:`, pure anchors, other URI schemes, unsafe traversal, backslashes, encoded separators, invalid encodings, decoded controls, and other suspicious destinations. Undefined shortcut-like bracket text is left as ordinary Markdown text because CommonMark does not distinguish it from prose without a matching definition.

### Phase 2A verification

| Command/check | Actual result |
|---|---|
| Focused red/green analyzer tests | Passed after observing required failures for the missing module, incomplete integration, encoded external scheme, output cap, formatted unresolved references, fragment coverage, query stripping, deep AST traversal, CR-only evidence, escaped syntax, interval-scan performance, and parser-safety admission |
| `npm run lint` | Passed on the final tree |
| `npm run typecheck` | Passed across all three workspaces on the final tree |
| `npm test` | Passed: 212 tests across 10 suites; 25 focused Phase 2A analyzer tests and all 187 Phase 0/1 regressions |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 11 Chromium tests after the backend-readiness race was diagnosed and fixed |
| Diff/secret review | Passed: scoped source/tests/configuration and lockfile only; matches for `secret`/`token` were intentional safe-error test sentinels |
| Independent review | Passed after fixes; final review found no current issue and approved the full verification gate |

Offline fixtures cover existing/missing files, complete versus truncated trees, inline/code/reference syntax, nested `../` and root-relative resolution, fragments, queries, directories, exact case, generated/router-style paths, deduplication, output/evidence bounds, external and unsupported categories, traversal/backslash/NUL/control/encoded-separator/invalid-encoding security cases, decoded external schemes, deeply nested ASTs, CR-only lines, escaped reference markers, mixed parsed/unresolved reference volume, and pathological parser-density admission. Analyzer correctness does not depend on a live public repository.

The first two full E2E attempts returned one 502 for the initial health-proxy request while the other ten tests passed. Debug logging proved Playwright was declaring Vite ready before port 3001 was listening; standalone `tsx watch` startup also exceeded the old 30-second readiness window. Playwright now builds/starts the compiled server separately and waits for `/api/health`; the focused regression and final 11-test suite passed. Existing `NO_COLOR`/`FORCE_COLOR` warnings remain harmless.

No live-repository smoke was run because controlled fixtures provide the required deterministic analyzer evidence and the user made a live finding optional. No check remains blocked. No push or pull request was requested or attempted. Phase 2A implementation commit: `1e795f1` (`feat: add Phase 2A local Markdown target analysis`).

## Phase 2B — conservative root npm-script command analysis (October 4, 2026)

- Added a second pure deterministic analyzer over already-fetched Phase 1 evidence. It reads only the selected root README and selected root `package.json`; it performs no GitHub calls, filesystem reads, package installation, command execution, npm invocation, or LLM call.
- Parses the README with the existing `remark-parse`/`unified` AST stack and inspects fenced `bash`, `sh`, `shell`, `zsh`, `console`, `terminal`, `text`, and `txt` code blocks, including AST-positioned fences nested in blockquotes or list items. Prose, inline code, indented code, and other fenced languages are not interpreted as commands.
- Recognizes only explicit standalone `npm run NAME` and `npm run-script NAME` forms. Ordinary trailing values are allowed, and arguments after npm's `--` delimiter remain script arguments. Script names are compared exactly and case-sensitively against own properties of the root `package.json.scripts` object; no aliases, fuzzy matches, inferred replacements, nested manifests, or workspace manifests are used.
- Skips `npm test`, `npm start`, installation commands, yarn/pnpm/Bun commands, shell prompts, comments, chained commands, pipelines, redirects, substitutions, environment assignments, quotes requiring shell interpretation, here-documents, line continuations, conditional/control bodies, workspace flags/forms, `--if-present` forms/abbreviations, and unrecognized npm configuration flags before `--`.
- Tracks simple lexical `cd` paths independently inside each supported code block. Root state resets for every block; deterministic relative moves away from root suppress comparison, and `cd ..` may resume comparison only when the tracked path returns exactly to root. Absolute/home/previous-directory paths, quoted or compound changes, `pushd`/`popd`, and compound shell lines that can change directory make the state uncertain and suppress subsequent comparison in that block.
- Safely parses only a JSON object with an own, plain `scripts` object whose values are strings. Missing/unavailable README or manifest evidence, invalid JSON, non-object manifests, missing/invalid scripts objects, and link-dense README parser admission failures return stable typed skipped statuses with zero invented findings. Other analyzers continue independently.
- Missing exact scripts produce only `needs-review` observations with difficulty `unknown`. Findings use stable SHA-256-derived IDs, deduplicate by type + README path + full script name, retain the first pinned README URL/path/line, bound displayed command/excerpt/script evidence to 240 characters, use deterministic newcomer-impact wording, and require manual inspection of surrounding README instructions, working-directory expectations, repository-local CONTRIBUTING guidance, monorepo/workspace structure, and maintainer intent.
- Coverage records checked commands, skipped commands and reason categories, findings produced/omitted, analyzer status/skip reason, and deterministic limitations. Unique findings are capped at 50. Phase 2A and Phase 2B share the existing pre-parse limit of 1,000 Markdown link openers so either analyzer leaves pathological link-dense documents unchecked before synchronous AST parsing.
- Integrated `npmScripts` beside `markdownLinks` in the existing typed snapshot analysis object. The browser runtime guard validates the Phase 2B response contract but does not render findings; Phase 3 cards, filters, and presentation work remain unimplemented.

### Phase 2B verification

| Command/check | Actual result |
|---|---|
| Focused red/green analyzer and integration tests | Passed after observing failures for the missing analyzer, snapshot integration, browser response validation, supported forms, ambiguity/working-directory safeguards, manifest trust states, bounds/deduplication, multiline shell context, compound directory changes, npm configuration flags, nested fences, and parser-safety admission |
| `npm run lint` | Passed on the final tree |
| `npm run typecheck` | Passed across all three workspaces on the final tree |
| `npm test` | Passed: 294 tests across 11 suites; 82 focused Phase 2B analyzer tests and all earlier regressions |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 12 Chromium tests, including the Phase 2B malformed-response contract regression |
| Diff/secret review | Passed: scoped source/tests/contracts only, no generated build output, whitespace errors, or credential-like material staged |
| Independent review | Found no Critical issues. Four Important parser/shell/npm-context issues and two in-scope evidence/fence gaps were reproduced with failing tests, fixed, and covered by the final green suite |

Offline fixtures cover defined and missing exact scripts, `run-script`, ordinary trailing arguments and the `--` delimiter, every supported fence language, prose/inline/indented/unsupported blocks, comments, chains, pipelines, substitutions, redirects, environment assignments, prompts, `--if-present`, workspace flags, npm configuration flags, npm special commands, unsupported package managers, deterministic and uncertain working-directory transitions, per-block reset, root return, absent/malformed/non-object manifests, missing/invalid scripts objects, exact case, pinned line/source evidence, deduplication, output/evidence caps, nested fences, and parser-density admission. Analyzer correctness does not depend on a public repository containing a known mismatch.

One initial combined focused run encountered the known transient Windows sandbox temporary-file `ENOENT`; the identical focused run and every final required command passed outside that sandbox. Playwright emitted the existing harmless `NO_COLOR`/`FORCE_COLOR` warnings. No required check was skipped or remains blocked. The optional live-repository smoke was not run because controlled offline fixtures establish analyzer correctness without depending on public repository content.

Phase 2B implementation commits: `54dd5fe` (`feat: add Phase 2B npm script analysis`) and `0637e43` (`fix: harden Phase 2B command parsing`). No push or pull request was requested or attempted. This documentation follow-up records the verified local checkpoint.

## Remaining work

Stop after this verified Phase 2B checkpoint. The recommended next step is a separately scoped Phase 2C task for deterministic labeled-issue opportunity findings. Do not combine it with Phase 3 presentation, ranking beyond the specification, difficulty estimation beyond `unknown`, external-link or heading-anchor validation, AI, cloning, repository execution, GitHub writes, databases, or background application agents. AI remains disabled and no billable AI call occurred.
