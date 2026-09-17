# Release Readiness Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan and review specification compliance before code quality.

**Goal:** Resolve newly reported dependency advisories and make release materials describe the implemented game behavior accurately before continuing OpenAI registration.

**Architecture:** Preserve the existing eight-tool MCP contract, server-authoritative saves, and immutable v21 widget. Update only affected compatible transitive dependencies and factual release copy; publisher verification and portal review remain external requirements.

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
- [ ] Commit the scoped changes; obtain independent specification and code-quality reviews before merge/push.

## Task 2: Complete available release steps

- [ ] Merge the reviewed commit into synced main and push, as authorized by the user's repository instructions and stable-publication approval.
- [ ] Verify GitHub CI and the existing Render redeployment, then reread the public MCP catalog/widget.
- [ ] Resume the OpenAI portal draft without substituting another person's identity; complete available non-sensitive fields and report any remaining identity/domain/demo/attestation requirement precisely.

The existing behavioral suite provides regression coverage for this dependency and copy-only change. No test that merely mirrors prose or lockfile versions is required.
