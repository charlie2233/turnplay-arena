# Release Readiness Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan and review specification compliance before code quality.

**Goal:** Resolve newly reported dependency advisories and make release materials describe the implemented game behavior accurately before continuing OpenAI registration.

**Architecture:** Preserve the existing eight-tool MCP contract, server-authoritative saves, and versioned widget compatibility. Update only affected compatible transitive dependencies, factual release copy, and automatic-opponent labels with an immutable v22 resource bump; publisher verification and portal review remain external requirements.

**Tech Stack:** Node 22.22.0, npm workspaces, TypeScript, React, MCP SDK, Vitest, Playwright.

## Task 1: Patch dependencies and release copy

**Files:** `package-lock.json`, `README.md`, `site/index.html`, `submission/demo-script.md`, `chatgpt-app-submission.json`, `progress.md`.

- [x] Sync with origin/main and establish baseline: typecheck, 264 server tests, 221 UI tests, static-site validation, production build, 9 browser tests all pass.
- [x] Record audit failure: fast-uri 3.1.5 (high), hono 4.12.34 (moderate), qs 6.15.3 (moderate).
- [x] Update only these transitive packages within existing dependency ranges using `npm update fast-uri hono qs --package-lock-only --ignore-scripts`; inspect the diff to reject unrelated updates.
- [x] Install the lockfile with `npm ci`, then require `npm audit --omit=dev` to report zero known vulnerabilities.
- [x] Correct README and demo text: automatic widget replies use the local difficulty-aware engine and submit a version-checked move through the host bridge; ChatGPT can operate tools and transcribe Go images, but the widget does not request a new model reasoning turn per tap. Remove obsolete polling/follow-up claims.
- [x] Correct stable-host status and link the existing live preview on the website, while clearly preserving pending OpenAI listing status.
- [x] Clarify the two read-tool open-world justifications as bounded reads from the app game store. Preserve their true read-only annotations and all input/output schemas.
- [x] Append dated verification results to progress.md without claiming publisher identity, domain verification, recording, or directory approval has completed.
- [x] Run `npm run typecheck && npm run test:ci && npm run build && npm run test:browser`, then `git diff --check`.
- [x] Commit the scoped changes; obtain independent specification and code-quality reviews before merge/push. Commit `f59ae2e` passed both independent reviews.

## Task 2: Make automatic-opponent labels accurate

**Files:** `web/src/components/GameChrome.tsx`, `web/src/components/SportsBoards.tsx`, `web/src/App.tsx`, existing affected tests, `web/index.html`, `server/src/mcp-server.ts`, `scripts/production-acceptance.mjs`, its `.d.mts` declaration, `scripts/verify-widget-bundle.mjs`, `scripts/verify-production.mjs`, `README.md`, `progress.md`, and the three submission screenshots.

- [x] Replace visible opponent labels (`GPT thinking…`, `GPT is`, score/history/error messages) with `Opponent` wording. Keep protocol actor `gpt`, helper identifiers, and real ChatGPT image-transcription instructions unchanged. Use `Opponent choosing a move…` for the in-flight status.
- [x] Update existing affected UI assertions without adding tests that merely mirror copy.
- [x] Bump the current resource to `ui://gpt-game-arena/v22/widget.html`, retain v21 in the legacy resource list, and set release marker `turnplay-v22-20260916-opponent`. Update the current verifier constants/declarations, errors, CLI defaults, and README; preserve historical progress entries.
- [x] Build the web workspace, calculate the exact resulting SHA-256, and update both declared bundle pins. Run typecheck, server/web/site tests, build, and all browser tests.
- [x] Regenerate the three 706-pixel-wide submission captures from the actual local app with a temporary isolated game store: Medium Chess as White, Hard 9x9 Go as Black, and a pending imported Hard 19x19 Go position with the player as White. Review the resulting captures for clipping and correct opponent labels.
- [x] Record results and commit the scoped changes.
- [ ] Obtain independent specification and code-quality review before merge/push.

## Task 3: Complete available release steps

- [ ] Merge the reviewed commit into synced main and push, as authorized by the user's repository instructions and stable-publication approval.
- [ ] Verify GitHub CI and the existing Render redeployment, then reread the public MCP catalog/widget.
- [ ] Resume the OpenAI portal draft without substituting another person's identity; complete available non-sensitive fields and report any remaining identity/domain/demo/attestation requirement precisely.

The existing behavioral suite provides regression coverage for this dependency and copy-only change. No test that merely mirrors prose or lockfile versions is required.
