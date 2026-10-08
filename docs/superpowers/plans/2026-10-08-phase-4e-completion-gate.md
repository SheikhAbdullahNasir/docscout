# Phase 4E Completion Gate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the integrated Phase 4 reliability/security layer, add only missing hostile-input regressions and offline CI, and complete Phase 4 only after every gate passes.

**Architecture:** Preserve the existing Phase 4A–4D implementation. Use deterministic Vitest and fixture-based Playwright coverage, a GitHub Actions workflow for offline core checks, and update `PROGRESS.md` only after verification and independent review.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript, Vitest, Playwright, GitHub Actions.

**Spec:** `PROJECT_SPEC.md`, sections 7, 11, and 12, plus the Phase 4 roadmap prompt; current completion state in `PROGRESS.md`.

## Global Constraints

- Analyze only public repositories and fixed GitHub API URLs; never clone or execute repository content.
- Per-file selected content is capped at 256 KiB; combined text at 2 MiB; tree responses at 10 MiB; other GitHub responses at 2 MiB.
- A scan allows 30 GitHub requests, each request has a 10-second timeout, and the whole scan has a 60-second deadline.
- The analysis request body is capped at 4 KiB and browser JSON responses at 3 MiB.
- CI must use API-shaped fixtures and fake GitHub transport; it must not require live repositories, tokens, or paid models.
- `AI_PROVIDER=none` remains the default; no Phase 5 behavior or deployment workflow is in scope.

## Review Focus

- GitHub redirects stay on validated HTTPS `api.github.com` repository endpoints and consume bounded request budget.
- Markdown with unsafe URL schemes or traversal remains unsupported rather than becoming a missing-target finding.
- Hostile issue/README content remains inert text in the browser and cannot trigger external requests.
- Incomplete tree and oversized/cancelled evidence remain explicitly partial or unknown.
- API errors, logs, and built browser assets contain no credentials, upstream bodies, headers, or stack traces.

---

### Task 1: Close concrete security regression gaps

**Files:**
- Modify: `apps/server/src/github/client.test.ts`
- Modify: `apps/server/src/github/client.ts`
- Modify: `apps/server/src/analyzers/localLinks.test.ts`
- Modify: `tests/e2e/phase1.spec.ts`

- [x] Add and run a failing test for one validated same-host HTTPS repository redirect; preserve rejection tests for cross-host, non-HTTPS, credentials, and unsafe endpoints.
- [x] Follow at most one validated redirect, account for its outbound request against the same scan budget, and preserve the current request deadline/queue boundary.
- [x] Add explicit `javascript:` and `data:` Markdown cases and fixture-based browser assertions for hostile issue text and no automatic resource loading.
- [x] Run the focused Vitest and Playwright checks: redirect/client/snapshot coverage passed (86 tests), the unsafe-scheme fixture passed, and the hostile-content browser fixture passed.

### Task 2: Add offline CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] Run on pushes and pull requests with Node.js 22 and `npm ci`.
- [x] Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`; do not add secrets, deployment, or paid services.
- [x] Manually validate the short workflow structure and review its diff; no local actionlint/YAML parser is installed.

### Task 3: Complete the Phase 4 gate

**Files:**
- Modify: `PROGRESS.md`

- [x] Run every user-required full verification command and deterministic security/secret inspection: lint/typecheck pass; 386 Vitest tests pass; build, production smoke, and 26 E2E tests pass; secret and hostile-input audits pass.
- [x] Review the diff and request an independent read-only code review; no Critical or Important findings remain. The reviewer noted only a non-blocking suggestion to add additional isolated invalid-redirect cases; the validator rejects those cases by inspection.
- [x] After all checks and review passed, record exact evidence, limitations, per-instance scope, and the next roadmap step in `PROGRESS.md`.
- [x] Commit the verified Phase 4E checkpoint and stop.

## Execution Log

- Ruling: Work in the current clean `main` checkout because the user explicitly requested continuation from the current repository state and authorized the scoped fix; cost if wrong: the checkpoint is created on the shared branch rather than an isolated worktree.
- Base commit: `e43d382`.
- Preflight: clean working tree; Phase 4A–4D implementation and focused tests inspected; no existing Actions workflow found.
- RED: the same-host HTTPS repository redirect regression failed with `GITHUB_UPSTREAM_FAILURE`; GREEN: one validated hop now succeeds with canonical metadata and a second request-budget charge.
- A full-suite run caught and drove a preservation fix for stage-specific errors on blocked commit/tree redirects; focused client/snapshot suites then passed 86/86.
- Final full verification: `npm run lint`, `npm run typecheck`, `npm test` (386/386), `npm run build`, `npm run test:production`, and `npm run test:e2e` (26/26) passed; staged `git diff --check` passed.
- Secret review: no high-confidence provider-token patterns in tracked files; `.env` absent and ignored; blank secret placeholders; no configured VITE values or server key values in the production browser bundle.
- CI review: push/PR triggers, read-only permissions, Node 22 setup, and the five required commands were manually inspected. No local actionlint/YAML parser is installed, and the workflow was not run remotely.
- Independent review of `e43d382..0fa9ef7` found no Critical or Important issues and independently confirmed `git diff --check`. It could not independently reproduce the full verification or secret audit; remote Actions and universal GitHub redirect shapes remain unverified. Minor recommendation: add focused invalid-redirect tests for same-origin credentials, changed query/fragment, invalid repository segments, and changed endpoint suffix.
- Full verification and review passed, and `PROGRESS.md` records the completion evidence and limitations. Phase 4E checkpoint: `0fa9ef7` (`ci: add DocScout Phase 4E gate and regression coverage`); completion documentation committed separately.
