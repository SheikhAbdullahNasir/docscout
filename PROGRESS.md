# DocScout progress

Approved source: `PROJECT_SPEC.md` version 1.0. Updated October 5, 2026.

## Phase status

- [x] Phase 0 — local workspace, scripts, blank environment example, basic URL form, health endpoint; acceptance gate passed.
- [x] Phase 1 — GitHub foundation, bounded snapshot data, and browser acceptance gate.
  - [x] Phase 1A — strict server URL validation and public repository metadata only.
  - [x] Phase 1B — default-branch commit snapshot and bounded recursive tree.
  - [x] Phase 1C — deterministic selected-document paths and bounded pinned content retrieval.
  - [x] Phase 1D — bounded open labeled-issue retrieval with explicit coverage.
  - [x] Phase 1E — minimal browser integration for repository metadata, pinned documents, labeled issues, and truthful states.
- [x] Phase 2 — evidence-backed core analyzers; completion gate passed October 5, 2026.
- [x] Phase 3 — usable results and complete UI states; completion gate passed October 5, 2026.
  - [x] Phase 3A — beginner-readable typed finding sections and cards.
  - [x] Phase 3B — beginner-readable coverage, partial, and empty-result presentation.
  - [x] Phase 3C — browser-only finding filters and per-finding Copy next steps.
  - [x] Phase 3D — responsive/accessibility cleanup and Phase 3 completion gate.
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

## Phase 2C — deterministic labeled-issue opportunity findings (October 4, 2026)

- Added a pure deterministic analyzer over the already-fetched Phase 1D `RepositoryIssues` evidence plus public repository metadata. It performs no GitHub calls, URL fetches, filesystem access, repository execution, or LLM calls. Snapshot orchestration still performs only the two existing supported-label issue streams and feeds their validated results to the analyzer.
- Creates one shared-contract `labeled-issue` finding per unique supported issue. Findings use stable SHA-256-derived IDs based on type + canonical issue source + issue number, confidence `maintainer-label`, difficulty `unknown`, exact maintainer labels, canonical issue URL/number, original issue title, assigned state/assignees, bounded Phase 1 body excerpt, and normalized update time.
- Keeps label semantics narrow and distinct. `good first issue` means maintainers applied a label commonly intended to signal a possible starting point, without guaranteeing ease or availability. `help wanted` means only that maintainers marked the issue as seeking help; it is never described as easy, quick, low risk, or beginner-friendly. An issue with both labels produces one good-first-issue finding.
- Ranks deterministically: unassigned `good first issue`, assigned `good first issue`, then `help wanted`; newest `updatedAt` first within each group; issue number ascending and source URL provide deterministic tie-breakers. Assignment remains evidence rather than suppression, and assigned findings explicitly require checking current discussion and assignment before treating work as available.
- Archived repositories retain evidence-backed findings but every finding receives an archive caveat that avoids implying active maintenance. Every finding also explains that labels are maintainer-provided evidence rather than DocScout difficulty estimates, that state/discussion/assignment can change, and that the current issue must be verified before work starts.
- Findings include deterministic manual verification steps: open the issue, read the latest discussion, check current work/assignment/status, read repository-local CONTRIBUTING guidance, inspect linked pull requests/recent comments, and ask maintainers before substantial work when expectations are unclear. No contact, issue, or pull request is automated.
- Caps labeled-issue findings at 20 after ranking and reports eligible, produced, and omitted counts. Phase 1 retrieval coverage remains separately preserved as the complete/sampled/per-label query record. Sampling and partial failure are independent caveats, including when both apply simultaneously; empty results stay narrow and never claim that no opportunities exist.
- Added a minimal common aggregation layer while preserving all three independently testable analyzer results. The shared finding list places Phase 2A/2B documentation findings before Phase 2C issue opportunities, caps combined documentation output at 50, retains the separate 20-issue capacity, and reports total documentation omissions including per-analyzer and combined-cap omissions.
- Ready snapshots expose `findings`, aggregation coverage, `markdownLinks`, `npmScripts`, and `labeledIssues` in the existing analysis object. Empty repositories preserve `snapshot: null` while exposing top-level Phase 2C analysis, because already-fetched open labeled issues can still be useful without a commit snapshot. The browser validates these contracts but does not render Phase 2 findings; no Phase 3 presentation work was added.

### Phase 2C verification

| Command/check | Actual result |
|---|---|
| Focused red/green analyzer, aggregation, integration, and browser-contract tests | Passed after observing failures for the missing analyzer, missing snapshot integration, missing browser guard, sampled-plus-partial coverage, empty-repository analysis, the shared documentation cap, and omission accounting mutation |
| `npm run lint` | Passed on the final implementation tree |
| `npm run typecheck` | Passed across all three workspaces on the final implementation tree |
| `npm test` | Passed: 311 tests across 13 suites; 17 new focused Phase 2C/aggregation tests and all earlier regressions |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 13 Chromium tests, including empty-repository Phase 2C and malformed-response contract regressions |
| Diff/secret review | Passed: scoped source/contracts/tests only; no whitespace errors, generated artifacts, or credential-like material; the only token match was the existing client configuration variable |
| Independent review | Initial review found no Critical issues and two Important coverage/integration gaps; both were fixed. Re-review found no remaining Critical or Important issues and verified focused tests/typecheck |

Offline fixtures cover unassigned and assigned good-first issues, help-wanted-only semantics, both labels, exact label/evidence retention, all ranking groups, update ordering and deterministic ties, deduplication, the 20-result cap, shared documentation ordering/cap, assignment and archive caveats, complete/sampled/partial/sampled-plus-partial retrieval, empty results, empty repositories with issues, and malicious issue-body text retained only as plain evidence. No live public-repository smoke was run because controlled fixtures establish deterministic correctness without depending on a repository currently containing supported labeled issues.

The first combined sandboxed Vitest runs encountered the known transient Windows temporary-file `ENOENT`, and sandboxed Supertest hit loopback `EACCES`; unchanged reruns outside those sandbox restrictions passed. Playwright emitted the existing harmless `NO_COLOR`/`FORCE_COLOR` warnings. No required verification check was skipped or remains blocked. Phase 2C implementation commit: `3dca3a0` (`feat: add Phase 2C labeled issue analysis`). No push or pull request was requested or attempted.

## Remaining work

Phase 3A now presents the existing typed findings in separate documentation and labeled-issue sections, with documentation first. Cards show title, confidence, unknown difficulty, server-provided source/evidence, why the finding matters, manual verification steps, and limitations; labeled-issue cards retain maintainer labels and assignment state. Empty finding sections describe only what the available checked evidence produced. Repository excerpts remain plain text and links remain limited to server-provided source URLs.

Phase 3B adds an always-visible coverage and scan-status section driven only by existing typed snapshot/analyzer/issue coverage. It distinguishes complete and useful partial coverage; reports tree and document-selection completeness, available/unavailable/skipped selected documents, analyzed/unchecked Markdown and link counts, npm-script checked/skipped status and reason, per-label issue query status/pages/caps, document-content omissions, and documentation/issue result-limit omissions. Empty repositories retain issue coverage while explicitly stating that commit-backed document and analyzer coverage was unavailable. An empty aggregate finding list says only: “No suggestions found in the checked scope.”

Phase 3C adds three native browser-only finding filters: All, Documentation, and Labeled issues. Filtering never changes analyzer output, preserves the original documentation-before-issues order when cleared, and distinguishes an empty filtered category from a repository-level checked-scope empty result. Every finding card now has a keyboard-accessible Copy next steps action that copies only its existing typed verification steps as a short Markdown checklist. Successful copies use an accessible status; unavailable or rejected clipboard access uses a safe alert while leaving the visible checklist intact.

Focused browser verification passed all 18 tests in `tests/e2e/phase1.spec.ts`, including all three filters, keyboard operation, filtered-empty truthfulness, restored source order, exact checklist copying, clipboard failure, and retained Phase 3A cards and Phase 3B coverage. `npm run typecheck` passed across all three workspaces, `npm run lint` passed, and `git diff --check` passed. Playwright required the permitted elevated localhost execution mode and emitted the existing harmless `NO_COLOR`/`FORCE_COLOR` warnings.

Phase 3D completed the responsive/accessibility gate without redesigning the existing result flow. Focused Playwright coverage now verifies result readability and zero page-level overflow at 360 px and 1280 px with genuinely unbroken 800-character URLs, excerpts, code, and labels. An initial independent review caught that the first hostile fixture contained normal hyphen wrap opportunities; the corrected regression failed at 360 px, and the smallest shipped fix bounds and wraps label text inside its own pill. Document previews retain their existing contained scrolling/wrapping behavior.

Keyboard-only verification now Tabs through the repository input, Analyze button, native finding radios, source links, and Copy next steps controls, confirms a visible focus outline on each, and uses arrow-key radio selection. Existing accessible status/alert semantics announce loading, successful completion, request errors, copy success, and copy failure. Existing labeled controls, semantic headings, plain-text previews, cards, coverage, filters, manual checklist copying, partial/empty/error states, and documentation-before-issue ordering remain intact. No AI or explain control is present while AI is disabled.

### Phase 3 completion gate (October 5, 2026)

| Command/check | Actual result |
|---|---|
| Focused Phase 3D red/green browser checks | Corrected 360 px unbroken-label regression failed before the CSS fix; passed at both 360 px and 1280 px afterward |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed across all three workspaces |
| `npm test` | Passed: 311 tests across 13 suites |
| `npm run build` | Passed: Vite frontend and TypeScript server builds |
| `npm run test:production` | Passed: health, frontend HTML, built JS/CSS assets, unknown API 404 |
| `npm run test:e2e` | Passed: all 25 Chromium tests, including 360/1280 result containment, keyboard focus, announcements, filters, copy actions, cards, coverage, previews, partial/empty/error states, and disabled-AI absence |
| `git diff --check` | Passed |
| Diff/secret review | Passed: changes limited to the scoped stylesheet, focused browser tests, and this progress record; no generated artifacts or credential material |
| Independent review | Initial review found one Important unbroken-label overflow gap; regression and minimal CSS fix added. Follow-up found no remaining Critical or Important issues |

Known limitations: automated browser verification uses Chromium only; it is not a multi-browser or assistive-technology audit. Playwright and production smoke required the permitted localhost execution mode, and Vitest required normal Windows temporary-file access after the restricted sandbox produced the known `ENOENT` failures. Unchanged reruns passed. Playwright emitted the existing harmless `NO_COLOR`/`FORCE_COLOR` warnings. No required verification was skipped or remains blocked.

Stop after this verified Phase 3 completion gate. The recommended next step is a separately scoped Phase 4 reliability task. Phase 4 work and AI remain unimplemented.

## Phase 2 completion gate (October 5, 2026)

Phase 2 is complete. A lightweight acceptance review confirmed that all three analyzers still match the Phase 2 contract, documented false-positive controls remain covered by focused tests, documentation findings remain before issue findings, and documentation/issue caps and coverage remain truthful. The analyzers remain pure over fetched evidence: no GitHub fetching, filesystem access, command execution, or AI work was found. Focused verification passed with 124 tests across four suites; `npm run typecheck` and `npm run lint` also passed. No acceptance gap or code change was required.

## Phase 4A — scan/request resource budgets and deadlines (October 8, 2026)

- Added a small per-scan `ScanBudget` shared from metadata lookup through pinned snapshot, selected content, and issue pagination. It exposes used/remaining requests, an absolute 60-second deadline, remaining time, and cancellation. Every dispatched attempt counts; request 30 is allowed and request 31 is prevented. No retry policy was added.
- Preserved the existing 256 KiB decoded UTF-8 file cap, 2 MiB combined text cap, and bounded document selection. Preserved streamed GitHub caps of 10 MiB for recursive trees and 2 MiB for other REST bodies; crossing a cap cancels reading and returns a typed safe error or explicit optional-content omission. Structured JSON is never silently truncated.
- Each request has a cancellable 10-second timeout covering headers and streamed body reading, with injectable-clock checks as well as timers. The shared scan deadline starts before metadata lookup, aborts remaining requests, and prevents new document parsing after expiry. Completed documents, findings, and issue pages remain useful partial evidence; unstarted/failed work is explicitly unknown or unchecked.
- Retained the analysis endpoint's 4 KiB JSON input limit and safe 413 response before GitHub work. Browser responses are measured as UTF-8 JSON before whole-response serialization and bounded to 3 MiB. Safe previews/excerpts are shortened first; oversized structural records are omitted whole with typed counts, incomplete delivery coverage, and a stable warning. Retained finding IDs, source references, and structural evidence are never shortened. Ordinary responses remain unchanged.
- Added browser validation/presentation for the additive partial scan coverage and deadline skip reason, preserving the existing ready/empty snapshot contract, finding order, filters, copy actions, and plain-text rendering. Analyzer implementations, public-only behavior, and fixed-host GitHub security are unchanged.

Focused offline verification passed **288 tests across 14 suites**, including **25 new Phase 4A tests** for shared budgets/pagination/attempt counting, streamed caps, timer and injected-clock boundaries, retained partial evidence, request-body rejection, response bounding/omissions, and browser contract/announcements. Existing selected-file/content-cap and Phase 2 analyzer regressions passed.

```text
npm test -- apps/server/src/github/client.test.ts apps/server/src/github/snapshot.test.ts apps/server/src/github/documents.test.ts apps/server/src/github/documentSnapshot.test.ts apps/server/src/github/issueSnapshot.test.ts apps/server/src/routes/repository.test.ts apps/server/src/routes/snapshot.test.ts apps/server/src/github/resourceLimits.test.ts apps/server/src/routes/browserBudget.test.ts apps/server/src/analyzers/localLinks.test.ts apps/server/src/analyzers/npmScripts.test.ts apps/server/src/analyzers/labeledIssues.test.ts apps/server/src/analyzers/analysis.test.ts apps/web/src/phase4Budget.test.ts
npm run typecheck
npm run lint
git diff --check
```

All commands passed on the final implementation. The initial restricted Windows Vitest run hit the known temporary-file `ENOENT`; the unchanged run outside that restriction worked. A later concurrent verification run hit the existing 2 MiB fixture's five-second test timeout; the unchanged focused command passed when rerun on its own, without changing the fixture or timeout.

No required check remains blocked. The whole test suite, production smoke, E2E, full build, and independent review were intentionally deferred to the Phase 4 completion gate. No live GitHub test was used. Queueing/admission, retries, deduplication, caching/LRU/ETags, IP rate limits/proxy changes, CI, and AI remain unimplemented. Stop at this Phase 4A checkpoint; the next step is a separately scoped, approved Phase 4B task.

## Phase 4B — serial GitHub requests, retries, and cooldowns (October 8, 2026)

Added a process-wide FIFO queue for all GitHub request attempts. Queue waiting uses the existing per-scan deadline and request budget. Each request may retry once for selected transient transport failures, request timeouts, HTTP 500/502/503/504, or a validated rate-limit cooldown. Cooldown parsing accepts bounded `Retry-After` values and rate-limit reset timestamps, preserves `retryAt`, and keeps permission 403 responses distinct. Retries and cooldown waits stop when the scan deadline or request budget cannot accommodate another attempt.

Focused offline verification passed **123 tests across 6 suites**, including queue ordering/cancellation, retry limits, cooldown parsing, and Phase 4A request/deadline regressions. `npm run typecheck`, `npm run lint`, and `git diff --check` passed. No live GitHub calls were used. Full suite, build, production smoke, E2E, and CI remain deferred to the Phase 4 completion gate.

Stop at Phase 4B. Recommended next step: a separately scoped Phase 4C task.
