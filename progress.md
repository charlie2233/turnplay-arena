Original prompt: also implement select difficuktuy

## MCP create-to-render contract increment

### Completed

- [x] Made normal-game creation explicitly data-only and require one immediate `render_game` call with the exact returned `gameId` to mount the interactive board.
- [x] Declared `render_game` as the non-mutating UI step for an existing normal game and kept imported Go on its direct `import_go_position` widget path.
- [x] Updated all four positive create workflows in the reviewer manifest to run `create_game, render_game` in order, while retaining the import-only workflow without a redundant render.
- [x] Added descriptor, manifest, and static-validator regression checks for this dependency.
- [x] Extracted one shared strict workflow validator for production and tests; creation workflows must start with adjacent `create_game, render_game`, including rejection coverage for known-tool prefixes.

### Exact validation

- [x] Focused `server/tests/mcp-server.test.ts`: 22/22 tests pass, including strict malformed-workflow fixtures.
- [x] Full server suite: 13/13 files and 239/239 tests pass.
- [x] Server typecheck (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json`) passes.
- [x] Root static-site validator (`npm run test:site`) passes.

## Goal (prior difficulty work; historical)

- Add Easy, Medium, and Hard difficulty selection to game creation.
- Preserve difficulty across reset and expose it to the ChatGPT move loop.
- Make standalone GPT move choice meaningfully difficulty-aware.

## TODO

- [x] Audit server and widget contracts.
- [x] Implement server-owned difficulty metadata.
- [x] Add the difficulty chooser and standalone strategies.
- [x] Run tests, browser gameplay verification, and visual review.

## Decisions

- Levels are Easy, Medium, and Hard; omitted difficulty defaults to Medium.
- Difficulty is immutable game metadata, preserved by reset and included in every snapshot.
- Changing difficulty takes effect when Start game creates a new game.
- The widget resource URI moved to v2 for that prior difficulty-only schema change; the current expanded release supersedes it with v3.

## Verification log

- Server domain, REST, MCP, schema, reset, and secret-safe validation checks pass: 64/64 tests.
- Server typecheck, production build, and diff check pass.
- Widget tests pass: 32/32; widget typecheck, production build, and diff check pass.
- In-app browser gameplay passes at 1536×1024 and 320×844. Draft difficulty stays separate from the active game until Start game; reset preserves it; the 320px layout has no horizontal overflow.
- Hard 19×19 Go replied to T1 with S1; Easy 9×9 Go replied to E5 with H8, confirming distinct legal-move strategies in the standalone preview.
- The skill-provided Playwright client smoke passes with a valid `render_game_to_text` snapshot and no reported console errors.
- Independent review led to endgame-aware Go passing, one-time group analysis for Hard 19×19, a bounded dense-board CPU regression, and a readable 12px mobile active-difficulty badge. The follow-up full suite passes 96/96.

## Next release gates

- Historical gate: deploy the then-current v2 widget over public HTTPS and refresh ChatGPT app metadata.
- Run an actual ChatGPT-host smoke test and the documented Node 18 compatibility smoke.

## Compact responsive boards

### Original prompt

- make the chess plate smaller for those exceeding the screen, kinda like tencent go app u know, the screen is definitely big enough

### Completed

- [x] Reproduced the 1280×720 chess board extending below the browser viewport.
- [x] Added a centered, height-aware board rail capped at 34rem on wide desktops and 26rem in ChatGPT-sized panes.
- [x] Removed forced nested scrolling from 13×13 and 19×19 Go so the full board scales as one overview.
- [x] Added ChatGPT `maxHeight` handling and bumped the widget cache URI to v10.
- [x] Passed 166 automated tests, typecheck, build, a 21-case responsive matrix, and a hosted ChatGPT chess turn with the full 416px board visible (`e2e4`, then GPT `e7e5`, no 502).

## Add more games

### Objective

- Expand the authoritative game arena to seven accessible presets while retaining one MCP/widget integration surface.

### Completed

- [x] Added and reviewed three authoritative engines: Tic-Tac-Toe, Connect Four, and Reversi.
- [x] Extended create/reset schemas and snapshots for all game kinds, board sizes, and difficulty metadata.
- [x] Made Chess, Tic-Tac-Toe, Connect Four, Reversi, and Go 9×9/13×13/19×19 accessible in the widget.
- [x] Added Easy, Medium, and game-aware Hard strategies.
- [x] Continued GPT turns when Reversi automatic skipping leaves GPT with the next turn.
- [x] Completed server and widget test/review coverage for the expanded arena.

### Key decisions

- Chess creates the player as White; Go, Tic-Tac-Toe, Connect Four, and Reversi create the player as Black, and those four engines are black-first.
- Board moves use each engine's displayed uppercase coordinate format; Chess remains long algebraic coordinates.
- Reversi passes are automatic when the side to move has no legal move; they are not player-entered moves.
- The material widget/schema expansion uses `ui://gpt-game-arena/v3/widget.html` to avoid a stale host cache.

### Current verification evidence

- 94 server tests plus 47 web tests pass: 141 tests total.
- Server and web typechecks, production builds, and scoped diff checks pass.
- In-app browser playthroughs pass for Tic-Tac-Toe, Connect Four, and Reversi on Hard; Easy Tic-Tac-Toe produces a distinct legal reply and reset preserves Easy.
- The skill-provided Playwright client returns a valid `render_game_to_text` snapshot with no console-error artifact.
- A 320×844 Reversi playthrough has zero horizontal overflow or browser errors; Connect Four exposes 7 actions, 6 rows, and 42 square cells after visual correction.

### Pending release gates

- Deploy the v3 widget over public HTTPS and refresh metadata.
- Complete actual hosted ChatGPT acceptance and the separate Node 18 built-server smoke.

## Fast, confirmed GPT turns

### Original prompts

- make it ezier for gpt to read uz its taking too long for him everytime, ans sometime he didnt place it but he said he placed it
- Let gpt work quicker is whatg i mean
- also everytim gpt thinks anf shit it brings me back to the end of chat convo so i have t scrolll up everytime if i wanna keep playin with gpt try solving that

### Implemented

- [x] Replaced the normal redundant `get_game_state` model round trip with a compact authoritative `FAST_TURN` packet.
- [x] Added difficulty-sized, exact-legal candidate sets with tactical ordering and spatially distributed Go coverage.
- [x] Bound new moves to both `expectedResetEpoch` and `expectedVersion` while preserving cached-widget compatibility.
- [x] Added server-authored `MOVE_CONFIRMED`, definite `MOVE_NOT_APPLIED`, and ambiguous `MOVE_CONFIRMATION_UNKNOWN` result language.
- [x] Switched ChatGPT follow-ups to `sendFollowUpMessage({ scrollToBottom: false })`, with standard `ui/message` fallback for other hosts.
- [x] Reduced the repeated model-facing output schema and bumped the widget cache URI to v11.
- [x] Shortened fallback board reconciliation to start at 750 ms and stop immediately on an explicit move rejection.

### Verification status

- [x] Compact decision tests cover 19×19 payload size, legal/unique caps, spatial variety, and tactical capture retention.
- [x] Bridge tests cover no-scroll delivery, portable fallback, and no duplicate retry after a rejected follow-up.
- [x] App tests cover nonzero epochs, no-scroll completion, authoritative moves outside the shortlist, and immediate failed-move exit.
- [x] Epoch/version race, omitted-epoch-after-reset, explicit receipt, and ambiguous post-commit tests pass in focused server coverage.
- [x] Complete matrix passes: 107 server + 68 web = 175 tests, workspace typecheck, production builds, and `git diff --check`.
- [x] Required web-game client smoke produced a clean screenshot and deterministic text state with no console-error artifact.
- [x] Local 1280×720 Real Go check: the 19×19 board is 416×416, has no horizontal overflow, and completed D16 → K19 in about 0.54 s.
- [x] Hosted ChatGPT v11 check: K9 → K18 landed in board history, and GPT narrated exactly K18 only after the authoritative board update.
- [x] Hosted scroll check: the ChatGPT scroll container stayed at 479 px and the widget top stayed at -73 px while GPT was thinking; after completion it shifted only 35 px and the board remained visible instead of jumping to the conversation end.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling the app permanently hosted.

## Authoritative End Game

### Original prompt

- add a endgame button

### Implemented

- [x] Added a dedicated `end_game` tool requiring explicit confirmation plus the exact reset epoch and state version.
- [x] Added a two-step inline confirmation (`Keep playing` / `End game`) that locks outside controls, traps keyboard focus, and never changes the board optimistically.
- [x] Preserved the board and move history while freezing the authoritative game with `finishReason: "ended"` and `Game ended.`
- [x] Persisted one terminal end event so an ended game stays ended after a server restart.
- [x] Added one-read recovery for an ambiguous end receipt without ever repeating the mutation.
- [x] Kept End Game available during GPT polling so a slow or stuck GPT turn can still be stopped.
- [x] Kept Reset, Refresh, and New Game available after ending; controls wrap into a compact mobile grid.
- [x] Bumped the widget cache URI to v12 and registered accurate destructive tool annotations.
- [x] Kept the v11 resource readable so historical ChatGPT boards continue loading after the v12 cache bump.

### Verification status

- [x] Full automated matrix passes: 113 server + 76 web = 189 tests.
- [x] Workspace typecheck, production builds, and `git diff --check` pass.
- [x] The skill-provided 1280x720 browser interaction shows the full board, confirmation copy, and both confirmation actions with no console-error artifact.
- [x] Hosted ChatGPT v12 acceptance passed through the v13 developer connection: cancel left a fresh game active; one confirmed end survived reload as `Game ended.` with every square disabled and Reset/Refresh available.
- [x] Hosted compatibility check passed: the historical v11 Go board loaded again after the legacy resource was restored instead of showing `Failed to fetch template`.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling this update permanently hosted.

### Separate Go-strength diagnosis

- Medium 19×19 Go currently sorts legal coordinates as strings and recommends the midpoint. That exactly reproduces the screenshot sequence `K19, K18, K2, K3, K17` and explains the weak vertical white shape.
- Replacing the Medium Go selector with positional/tactical scoring is a separate follow-up; End Game does not change move strength.

## Game-aware AI search

### Original prompts

- he still actin stupid wth ;et hiom think in go, then let me playbagain
- bro let him be smarter on all games he kinda stupid wth
- moret think thean prompt bro

### Implemented

- [x] Removed every Medium sorted-midpoint choice and routed Medium through game-aware evaluation.
- [x] Added complete Hard Tic-Tac-Toe minimax, fixed-depth alpha-beta search for Connect Four, and mobility/positional alpha-beta search for Reversi.
- [x] Added real `chess.js` position replay plus bounded two-ply Medium and three-ply Hard Chess search, with the existing static evaluator as a safe fallback for synthetic snapshots.
- [x] Reworked sparse Go openings to prioritize unclaimed corner anchors, whole-board spacing, and third/fourth-line play while retaining capture, atari rescue, self-atari, eye-fill, and pass safeguards.
- [x] Removed weak lexicographic Go fillers from Medium/Hard FAST_TURN shortlists.
- [x] Kept the prompt compact and receipt-gated; game-specific text now supports the actual engines without treating candidate order as a verdict.
- [x] Bumped the final widget cache URI to v14 while retaining v13, v12, and v11 compatibility resources.

### Verification status

- [x] Focused strategy suite passes 23/23, including Chess mate and opening-latency limits, Tic-Tac-Toe fork defense, Connect Four support-blunder defense, exact forced-pass Reversi endgames, and the reproduced 19×19 Go edge-ladder regression.
- [x] Hard Chess uses independent bounded root budgets: ordinary openings measured around 0.3–0.7 s in review, while the automated opening regression stays below 2 s.
- [x] Full automated matrix passes: 113 server + 86 web = 199 tests; workspace typecheck, production builds, and `git diff --check` pass.
- [x] The required browser game client produced final screenshots and deterministic text state with no error artifact; the 1280×720 Chess board and controls remain fully visible.
- [x] Hosted ChatGPT acceptance passed after refreshing the developer connection to the new engine: Black `D16` received the confirmed Hard reply `D4` in the opposite open corner, replacing the stale v12 `D10` behavior; final handoff uses the v14 cache URI.
- [x] The hosted board was reset after acceptance and left as a fresh empty Hard 19×19 game with the user to move as Black.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling this update permanently hosted.

## Continue Go from a photo

### Original prompt

- make him able to edit the things like go before it was open likme i can tell him to continue from a go match, and gibve him the poicture. and tell him to be wiote

### Implemented

- [x] Added a dedicated `import_go_position` MCP action for photo-derived 9×9, 13×13, and 19×19 Go positions.
- [x] Made user color, GPT color, next turn, difficulty, stones, and optional capture counts explicit instead of guessing them on the server.
- [x] Added strict coordinate, duplicate, overlap, capture-count, and zero-liberty-group validation.
- [x] Preserved the imported root through the first move, cloning, reset, manual end, JSON persistence, and process restart.
- [x] Added an `IMPORT_CONFIRMED` receipt and direct v16 widget rendering; unknown mutation outcomes are never narrated as success.
- [x] Added a visible photo-position review card backed by a persisted `pending`/`confirmed` server state. Both sides, Refresh, and direct move calls are blocked before the versioned `IMPORT_REVIEW_CONFIRMED` acceptance.
- [x] Trigger exactly one GPT turn after authoritative acceptance when GPT moves next; player-turn imports unlock without a GPT prompt.
- [x] Made pre-play corrections safe: GPT re-imports the complete corrected position rather than recording setup stones as alternating moves.
- [x] Documented the deliberate import boundary: prior ko history, passes, and unknown captures cannot be reconstructed from one image.

### Verification status

- [x] Complete automated matrix passes: 126 server + 93 web = 219 tests; workspace typecheck, production builds, and `git diff --check` pass.
- [x] The required 1280x720 browser game client produced a valid deterministic text snapshot, a fully visible board/controls screenshot, and no console-error artifact.
- [x] The public v16 MCP catalog exposed all eight tools, the v16 widget template, and the app-only import-confirmation action under the documented size budget.
- [x] Hosted ChatGPT vision transcribed the supplied 19x19 screenshot as Black `D16, P16, D4, Q4, F3` and White `K19, K18, K17, K3, K2`, preserved White to move on Hard, and correctly reported that no move was played.
- [ ] Finish the hosted widget acceptance against a non-expiring endpoint: the v16 developer app's temporary tunnel expired while loading the review card, so confirmation/unlock remains a deployment-gated check.
- [ ] Replace the temporary `trycloudflare.com` acceptance tunnel with an approved stable deployment before calling the app permanently hosted.

## Chess and Tic-Tac-Toe screen fit

### Original prompts

- chess and tiktactoe capabiluty is bad
- i mean screen capblitiy

### Reproduced

- [x] At an 800×520 short ChatGPT-style pane, the shared stacked layout shrinks Chess to 180×180 while the three game controls collapse into multiple rows below the viewport.
- [x] At 800×600, both games still push Reset/Refresh and the status below the viewport because the 1150px breakpoint stacks the role rail above the board despite enough horizontal room.

### TODO

- [x] Use a compact three-column landscape layout in medium-width panes so roles and history stop consuming vertical board space. The rule is scoped to Chess and Tic-Tac-Toe; an 800×600 Reversi check retained the prior single-column layout.
- [x] Size Chess and Tic-Tac-Toe independently, keeping Tic-Tac-Toe larger because it has no coordinate rails.
- [x] Keep all three active-game controls in one responsive row and use two equal columns after a game finishes.
- [x] Give Chess eight explicit equal rows and Tic-Tac-Toe three explicit equal rows so piece content cannot stretch the grid or move the tap target to a different coordinate.
- [x] Verify responsive screenshots, text state, tap targets, and console output:
  - 800×520 Chess: 320×320 board, eight equal 39px ranks, all `a8` through `a1` center hit-tests correct, controls bottom 471, status bottom 487, and no page overflow beyond the 520px viewport.
  - 800×520 played Tic-Tac-Toe: 304×304 board, nine equal 98×98 cells, `B2` produced the authoritative player move plus GPT `A3`, all cell center hit-tests correct, and controls/status remain above 454px.
  - 416×360 played Tic-Tac-Toe: compact side-by-side roles and 192×192 board, controls bottom 320 and last-move status bottom 336; move history continues below without pushing the board away.
  - 320×568 Chess: 224×224 board, eight equal 27px ranks, all center hit-tests correct, controls/status bottom 482, and document size exactly 320×568.
  - 390×844 Chess: 334×334 board, eight equal 41px ranks, all center hit-tests correct, and controls/status remain within the viewport at 822px.
  - 1280×720 Chess: 384×384 board, eight equal 47px ranks, all center hit-tests correct, and the complete table ends at 705px.
  - Finished Tic-Tac-Toe: exactly two 148px Reset/Refresh tracks; the End Game confirmation keeps both action buttons visible in the short pane.
  - In-app browser diagnostics returned no console errors. The bundled web-game Playwright client produced `shot-0.png` plus authoritative `state-0.json` with no `errors-*.json` artifact.

## Add Pool and Basketball Duel

### Original prompt

- add more games like pool, basktball starsetc.

### Decisions

- [x] Use original game identities: **Mini 8-Ball** and **Court Duel**, without copying Basketball Stars branding or assets.
- [x] Keep the existing generic eight-tool contract; every action remains one exact string from the authoritative snapshot's `legalMoves` array.
- [x] Keep both sports games deterministic and replay-safe so refresh, reset, persistence, and GPT narration cannot disagree with the server.
- [x] Mini 8-Ball uses finite `POT:<ball>:<pocket>` and `SAFE:<zone>` actions, group clearance, extra turns for pots, and an 8-ball win.
- [x] Court Duel uses `drive`, `pull-up`, and `three`, public energy/accuracy, five regulation attempts per side, and bounded overtime.

### TODO

- [x] Add strict server engines, snapshot schemas, replay/persistence coverage, and MCP catalog support for both games.
- [x] Add responsive, accessible Pool and Court Duel boards with score/progress displays and authoritative result feedback.
- [x] Add Easy, Medium, and Hard game-specific GPT evaluation without exposing deterministic outcome rolls.
- [x] Run the full automated matrix plus required browser-client, text-state, viewport, and console checks.
- [x] Sync, commit, push, and verify the public GitHub revision; keep hosted ChatGPT acceptance as a separate deployment gate.

### Verification status

- [x] Server coverage reaches 147 tests and web coverage reaches 103 tests (250 total), including rules, persistence, MCP/tool contracts, replay determinism, semantic snapshot invariants, difficulty strategy, accessibility, and compact text state.
- [x] Court Duel outcomes use HMAC-SHA256 with a random persisted 256-bit server-private seed. Clone, end, reset, and restart preserve the sequence; malformed or missing seeds fail closed; snapshots and tool output never expose the seed.
- [x] Court Duel snapshots are rejected when shot options, legal moves, history/results, points, score, energy, attempts, streak, turn, phase, round, status, winner, or version disagree.
- [x] Pool clears pending ball selection across moves, reset, and new games; keyboard users can select a ball with Enter and Tab directly to its first legal pocket, with a polite live instruction.
- [x] The bundled browser-game client played one complete two-ply Pool safety exchange and one complete two-ply Court Duel round. Both produced authoritative `state-0.json` snapshots and screenshots with no `errors-*.json` artifact.
- [x] At 800×520, the Pool table is 394×197 and the Court is 394×207; both keep controls and status fully visible.
- [x] At 320×568, Mini 8-Ball and Court Duel keep the board, one-row three-button game controls, and final status inside the exact 320×568 document. In-app browser diagnostics returned no warnings or errors.
- [ ] Deploy the v17 widget to an approved stable HTTPS endpoint and reconnect it in ChatGPT before calling either game hosted-live.

## Saved games

### Original prompt

- make sure a game sa ve

### Reproduced

- [x] The same ChatGPT card already cached and reconciled its last authoritative snapshot, and the JSON event log already replayed all seven game kinds after a one-process restart.
- [x] Standalone `/preview` forgot the game ID on reload and silently created a fresh medium Chess game.
- [x] The server's hidden one-hour inactivity timeout made a cached board unplayable after expiry, and reaching the session limit silently evicted the least-recently-used save.

### TODO

- [x] Auto-save and reconcile the standalone browser's exact game ID, reset epoch, state version, and snapshot before any fallback game creation.
- [x] Extend the sliding retention default to 30 days, expose validated retention/capacity settings, and refuse new games instead of deleting an existing save at capacity.
- [x] Prove move, reset, and manual-end persistence for all seven game kinds plus a real built-server stop/restart.
- [x] Run the complete automated matrix, production builds, browser-game client, and screenshot/text/error inspection.
- [ ] Keep stable hosted persistence and secure cross-chat saved-game ownership as explicit deployment gates; widget/local browser state is not a database.

### Verification status

- [x] Complete automated matrix passes: 167 server + 111 web = 278 tests, including exact standalone remount recovery, malformed/blocked browser storage, 30-day sliding retention, capacity preservation, and move/end/reset restart replay for all seven game kinds.
- [x] Workspace typecheck, both production builds, and `git diff --check` pass; the current cache-busting widget resource is v18 with v17 through v11 retained.
- [x] A built-server black-box acceptance created Hard Chess, played `e2e4`, killed the OS process, restarted against the same save file, and restored the same game ID at reset epoch 0 / state version 1 with exactly one history entry.
- [x] A real browser reload restored the same standalone game ID/version with exactly one `get_game_state` request and zero `create_game` requests; the saved envelope reported format version 1.
- [x] The required browser-game client produced `shot-0.png` plus authoritative `state-0.json`, with no error artifact. Visual inspection confirmed the full 1280×720 Chess board, selectors, End game/Reset/Refresh controls, and status remain visible.
- [ ] Deploy v18 against approved persistent hosted storage and reconnect it in ChatGPT before calling saves durable across container replacement or available as a secure cross-chat library.

## Submission and confirmation-safe resets

### Original prompts

- how can we publish this
- make sure a game sa ve
- let me play

### Implemented

- [x] Declared compact `outputSchema` metadata for all eight MCP tools and required the authoritative `resetEpoch` in every successful model-facing snapshot.
- [x] Made state and render lookups genuinely read-only: they no longer refresh retention or rewrite the persisted event log.
- [x] Added a production container baseline with non-root execution, an absolute persistent-volume path, startup writability probe, separate liveness/readiness checks, root `start`, and graceful termination.
- [x] Validated the exact public HTTPS origin, advertised it as the widget domain, and added the OpenAI domain-verification challenge route.
- [x] Made reset destructive only after explicit confirmation and an exact `(resetEpoch, stateVersion)` match, with `RESET_CONFIRMED`, `RESET_NOT_APPLIED`, and `RESET_CONFIRMATION_UNKNOWN` receipt semantics.
- [x] Added `chatgpt-app-submission.json` covering all eight tools, exactly five positive cases, and exactly three negative cases without inventing publisher identity.
- [x] Added public-repo CI for install, typecheck, all tests, both builds, container build, and a real container readiness smoke.
- [x] Bumped the current widget resource to v19 while retaining v18 through v11 for historical chats.

### Verification status

- [x] Complete automated matrix passes: 191 server + 118 web = 309 tests, both workspace typechecks, both production builds, and `git diff --check`.
- [x] The submission JSON parses and contains eight tool records, five positive tests, three negative tests, and a subtitle within the 30-character limit.
- [x] The existing hosted v18 Tic-Tac-Toe card was refreshed from the authoritative save; its stale-version alert cleared and the current `C3 → B2` history is visible with Black to move.
- [x] Frontend reset confirmation covers cancel/focus, exact payload, no optimistic reset, definite rejection, one-read ambiguity recovery, malformed reconciliation, imported roots, finished games, and GPT-turn interruption.
- [x] Built-server production smoke passed fail-closed configuration, save-mount preflight, `/health`, `/ready`, exact domain challenge, graceful shutdown, eight-tool MCP discovery, v19 widget metadata, and persistence across restart. Docker is unavailable locally, so the new CI owns the executable image-build smoke.
- [x] The required browser-game client opened the v19 Chess reset confirmation at 1280×720, produced matching authoritative `state-0.json` plus `shot-0.png`, kept the complete board and both confirmation actions visible, and emitted no `errors-*.json` artifact.
- [ ] Deploy to a stable public HTTPS host with durable single-replica storage, verify the domain, run the live tool scan and reviewer cases, add publisher-matched website/support/privacy/terms/logo assets, and complete hosted ChatGPT acceptance before submission.

## Public-beta production and submission hardening

### Objective

- Turn the working v19 developer build into an honest, inspectable public-beta candidate without claiming that a temporary tunnel or ephemeral container is production hosting.

### Implemented

- [x] Rebranded public-facing product surfaces to **Turnplay Arena** so the app name does not use the GPT brand; retained internal package/resource identifiers for compatibility and bumped the current widget resource to v20 with v19 through v11 readable.
- [x] Added explicit CIDR or fixed-hop proxy trust, spoof-resistant HMAC rate-limit keys, bounded rate-limit response headers, and tests that forwarded addresses are ignored unless the proxy topology is configured.
- [x] Added allowlisted JSON-line request/tool/lifecycle telemetry that never records request bodies, moves, game IDs, tokens, raw network addresses, or internal error details.
- [x] Made production persistence sync the temporary file, atomic rename, and parent directory before success; `/ready` now checks storage as well as the widget.
- [x] Added a 15-minute physical expiry sweep, startup pruning, and a configurable seven-day default retention for one-time v1 migration backups.
- [x] Extended CI to stop and recreate the production container against the same persistent Docker volume, then verify the exact game ID, version, move, and history after restart.
- [x] Added a polished static website with privacy, terms, secret-safe Formspree support, original vector branding, sitemap, strict CSP, and automated local-link/policy/brand validation.
- [x] Added a pinned-action GitHub Pages workflow, reviewer-ready listing/demo sources, exactly five self-contained positive cases and three negative cases, and direct-dependency notices.
- [x] Added a Render Blueprint for a paid one-instance service with a 1 GB persistent disk and CI-gated deploys; proxy trust remains unset until the hosted forwarding chain is measured and spoof-tested.
- [x] Created original 512×512 listing/composer assets and three real 706-pixel-wide product screenshots for Chess and Go.

### Verification status

- [x] Complete automated matrix passes: 229 server + 119 web = 348 tests, both workspace typechecks, both production builds, static-site validation, and `git diff --check`.
- [x] The manifest passes the live official OpenAI submission schema with eight tools, exactly five positive cases, and exactly three negative cases; all nine derived positive-case tool invocations pass their exported input schemas and expected receipts locally.
- [x] Render's current Blueprint schema accepts the one-instance persistent-disk configuration with `autoDeployTrigger: checksPass`; proxy trust is intentionally absent until measured on the real host.
- [x] A fresh built-server black-box smoke created Hard Chess, recorded `e2e4`, terminated cleanly, restarted on the same save path, and restored the exact game ID at version 1 with one matching move.
- [x] The public temporary tunnel completed an MCP initialize/list/create/move flow and returned a matching authoritative move receipt. This is developer-live proof only, not stable-host acceptance.
- [x] The v20 browser client and the static website passed desktop/mobile viewport, text-state, visual, and console-error checks; the complete game board stays visible and does not force the ChatGPT conversation to the bottom.
- [x] GitHub Pages deployed the public website; the home, privacy, terms, and support URLs each returned HTTPS 200, and Formspree accepted one secret-free support smoke submission.

### Remaining external gates

- [ ] Fill the verified publisher/legal identity and final host/log/support retention details in the now-live policy pages.
- [ ] Owner chooses a source-code license or intentionally keeps the public repository unlicensed.
- [ ] Owner approves a paid persistent host; deploy one replica, set its exact public origin, and prove create/move/redeploy/resume over HTTPS.
- [ ] Record the short demo against the final stable production endpoint and confirm the prepared listing assets/screenshots in Apps Management.
- [ ] Verify the domain, pass the tool scan and reviewer cases, select availability, submit through Apps Management, and complete a fresh hosted ChatGPT turn against the stable v21 endpoint.

## Direct authoritative embedded GPT turns

### Implemented

- [x] Replaced App-level ChatGPT follow-up messages and polling with the deterministic game-specific `chooseStandaloneMove` engine and one versioned `play_game_move` call for every embedded GPT turn.
- [x] Require the returned snapshot to be the exact one-ply GPT advance for the chosen notation, game ID, reset epoch, state version, sequential appended `ply`, and a field-for-field matching `lastMove` (actor, color, notation, and ply) before applying it to the board.
- [x] Ignore every tool-result notification while its direct GPT receipt or one-read reconciliation remains pending; explicit End/Reset actions synchronously invalidate that pending epoch before their own authoritative calls.
- [x] Let an accepted authoritative notification supersede any other busy action by advancing the action epoch, clearing transient busy/reset state, and applying the notification before continuing exactly one GPT turn when GPT owns the board.
- [x] Accept a cross-epoch tool-result notification only when it is the exact canonical one-epoch reset of the current game; corrupt resets and skipped-epoch jumps remain ignored after pending work clears and while idle.
- [x] Treat only an anchored `MOVE_NOT_APPLIED` protocol result, validation, or version failure as definite: report it without a state read or a second mutation.
- [x] Treat transport or mismatched-confirmation outcomes as ambiguous: read state once and accept only the matching exact GPT advance, strict manual-End advance, or canonical per-game reset; otherwise show the safe Refresh error.
- [x] Validate every direct or recovered reset against the exact server opening for Chess, normal/imported Go, Tic-Tac-Toe, Connect Four, Reversi, Pool, and Basketball, preserving array order while ignoring message text and object-key order.
- [x] Preserved bridge follow-up-message compatibility independently; the App no longer uses that path. End/Reset interruption, Go import review, saved-game reconciliation, and repeated GPT turns remain supported.

### Verification status

- [x] Focused `web/src/App.test.tsx`: 77 passing tests, including direct embedded success with one selected move/no message/no state read, exact receipt unlock, sequential-ply and missing/mismatched-`lastMove` rejection, one-read exact recovery without replay, safe malformed-recovery rejection, accepted reset notification supersession over a delayed human response, exactly-one GPT continuation from an accepted human-move notification, pending/post-receipt/idle corrupt-notification rejection, canonical idle reset acceptance, multi-epoch jump rejection, anchored definite-result recognition, one-read GPT/End/Reset recovery without replay, corrupt direct/GPT reset rejection, stale-recovery epoch suppression, Go review gating, repeated GPT turns, and explicit End/Reset interruption.
- [x] Pure canonical reset validation: 16 passing tests covering every game kind, all three normal Go sizes, imported Go, lifecycle and per-kind corruption, canonical array order, and object-key reordering.
- [x] Cross-layer reset parity: 10 passing tests feed actual in-memory `ToolService`/`GameStore` resets for every game kind, Go 9/13/19, and imported Go through the web validator.
- [x] Full web suite: 163 passing tests across 9 files.
- [x] Web TypeScript check: `tsc -p tsconfig.json --noEmit` passes.
- [ ] Hosted ChatGPT acceptance remains a separate stable-endpoint gate; the live server and temporary tunnel were not stopped, restarted, or modified during this increment.

## Player-side starts and terminal Try again

### Implemented

- [x] Added an accessible `SIDE` draft selector with exact Black/White choices. Draft game, difficulty, and side remain independent from the authoritative game until Start, then resynchronize only when a new authoritative game is accepted.
- [x] Send the selected `playerColor` for all nine game presets. `boardSize` remains omitted for every non-Go game and Quick Go 9×9, and is sent only for Go 13×13 and 19×19.
- [x] Continue Start and reset receipts through the existing direct, versioned GPT-turn path when the selected player does not own the opening turn; no `get_game_state`, follow-up message, or optimistic move is added on confirmed success.
- [x] Guard Start/opening races so late create or opening receipts cannot replace a newer authoritative notification or a newer reset epoch.
- [x] Keep active games' existing Reset flow and present finished games as `Try again` with the exact confirmation copy, while continuing to use the same authoritative `reset_game` contract and preserving game, difficulty, board size, and player side.
- [x] Exposed `draft.side` and the context-sensitive Reset/Try-again label and prompt through `window.render_game_to_text`.
- [x] Extended the chooser to four responsive controls; the narrow-phone layout uses a second-row Start action below 401px, and the decorative title stays hidden through the compact 760px layout.
- [x] Keep Chess and Tic-Tac-Toe in the compact single-column table through 760px, and use a confirmation-only short-landscape grid that places the board beside the dialog while preserving autofocus and the focus trap.

### TDD and validation status

- [x] Expected-red focused App run: 74/84 passed, with 10 intended failures for the absent side selector, direct opening continuation, and terminal Try-again behavior.
- [x] Focused `web/src/App.test.tsx`: 85/85 passed after implementation, including standalone and embedded starts, exact payload/version/epoch assertions, draft isolation, late-receipt races, all presets, active Reset, terminal Try again, focus restoration, and retry-side opening continuation.
- [x] Focused late-opening/reset race: 1/1 passed.
- [x] Web TypeScript check and production build passed; `git diff --check` passed.
- [x] Responsive browser guard at 416×360 passed with all chooser controls, the full Chess board, controls, and status visible and all 64 square center hit-tests correct.
- [x] Closed the 681–700px header boundary by keeping the non-shrinking title hidden through 760px; the focused CSS regression guard passes at both widths, and web typecheck plus the production build pass.
- [x] Responsive CSS guards pass 6/6 for the 681/700/760 table boundary and short-landscape confirmation structure; focused Try-again App coverage passes 2/2, and web typecheck plus the production build pass.
- [x] Final isolated suites pass with 239/239 server tests and 177/177 web tests across ten files. Both workspace typechecks, both production builds, static-site validation, and `git diff --check` pass on the release head.
- [x] The required web-game client produced a clean 1280×720 screenshot plus authoritative text-state with no error artifact. The real DOM/browser matrix passes at 320×568, 390×844, 416×360, 700×844, 800×520, and 1280×720 with square boards, no picker overlap or horizontal overflow, all 64 Chess center hit-tests correct, and every essential board/control/status region visible.
- [x] A real Hard Tic-Tac-Toe White start sent exactly `create_game` then one versioned GPT `B2` move. End plus Try again preserved the same game/settings, incremented `resetEpoch`, sent exactly `reset_game` then one versioned GPT `B2` move, retained the divergent draft, restored Reset, preserved focus, kept `scrollY` at zero in the 416×360 dialog layout, and emitted no console or page errors.
- [ ] Stable hosted ChatGPT acceptance remains separate; the live Node server on port 8000 and Cloudflare tunnel were not stopped, restarted, or modified.

## Pointer-only restore and MCP Apps lifecycle

### Implemented

- [x] Replaced ChatGPT widget state and standalone local storage snapshots with a strict v2 `activeGameId` plus draft game/difficulty/side schema; valid legacy saves contribute only that pointer and those safe preferences.
- [x] Restore renders no cached board and performs exactly one authoritative `get_game_state` read, including under React StrictMode; failed or expired pointers clear to an accessible New Game recovery state.
- [x] Added parent-only tool-input and tool-cancelled bridge notifications with unsubscribe/disposal cleanup, and require a valid negotiated MCP Apps `2026-01-26` initialize result before announcing initialized.
- [x] Added neutral embedded waiting, cancellation/error recovery, strict `toolOutput`-before-`initialState` arbitration, late-result recovery, and synchronous pointer-only widget persistence through the host's void-only setter contract; synchronous persistence failures stay contained and never block gameplay. Lifecycle tool-result notifications validate and apply state only and never initiate mutation tools; pointer reads remain isolated until their direct response, and explicit Start permanently closes older bootstrap-result acceptance.
- [x] Published the cache-busting widget contract as resource v21 while retaining v20 through v11 for historical ChatGPT cards.

### Verification status

- [x] Focused App/schema/storage/bridge coverage passes 143/143, including strict v2, legacy migration, storage failures, synchronous host persistence failure containment, source arbitration, pointer isolation, lifecycle races, notification origin/unsubscribe/disposal, initialize validation, and existing gameplay paths.
- [x] The complete web suite has 221 tests across 11 files. All 220 behavioral checks pass; the remaining wall-clock-only Hard-Chess check previously passed at about 1.5 seconds, while the latest loaded-host run measured about 2.3 seconds against its 2-second budget at a system load average above 54. Clean serial CI remains the release authority for that performance assertion.
- [x] Added a checked-in Playwright/Chromium gate: 9/9 real-browser tests cover six exact width/height layouts plus real mobile/touch emulation, picker containment/non-overlap, 64 Chess hit targets and an applied opening at every width, real Hard Tic-Tac-Toe player/GPT turns, End/cancel/Try again call ordering and reset epochs at 416×360, pointer-only no-board restore with exactly one intercepted state read, zero unsolicited creates, zero runtime errors, and CI execution against an isolated port/uniquely cleaned store.
- [x] Made the default browser command artifact-safe: it never rebuilds `web/dist`, never binds port 8000, and runs with a uniquely cleaned temporary save. CI builds first in its own runner and runs the unit suites serially so the Chess timing check does not compete with other test files.
- [x] Pinned patched Vitest, Ajv, and MCP SDK releases. `npm audit --omit=dev` reports zero production findings; SDK 1.30.0 resolves the transitive Hono advisory, and the server now explicitly matches the repository's Node 20.19 runtime floor required by the patched dependency graph.
- [ ] Stable hosted ChatGPT acceptance remains a separate gate. The paid Render endpoint, reviewed widget, public MCP handshake, spoof-resistant rate limiting, and restart persistence now pass, but a fresh mounted ChatGPT player/GPT turn against that stable endpoint is still required.

## Stable production acceptance harness

### Implemented

- [x] Added a provider-neutral `verify:production` seed/resume workflow for one exact v21 origin. Seed checks health, readiness, security headers, the exact OpenAI challenge, all eight reviewed MCP tools, the current widget resource/domain plus immutable marker and pinned bundle digest, and one exact board/legal-move receipt-confirmed Hard Tic-Tac-Toe player/GPT sequence before writing private evidence.
- [x] Keep the portal token in a descriptor-validated, size-bounded, non-symlink mode-`0600` file supplied with `--challenge-token-file`; never place the token in CLI arguments, logs, receipts, Git, or support messages. The seed receipt is atomically reserved before networking, private mode `0600`, size-bounded on resume, and never overwritten implicitly; a failed seed retains its reservation to block an unsafe repeated mutation.
- [x] Bind every challenge and MCP response to the same non-cacheable process identity as health/readiness, with time- and size-bounded bodies. Resume requires that identity to change, then verifies that the exact authoritative game state and reviewed v21 render survived on the same origin and persistent disk. Same-process and within-phase split routing are rejected; interpreting the changed identity as a restart additionally depends on the separately verified one-instance provider topology.
- [x] Production-origin validation rejects HTTP, localhost/IP/example origins, redirects, URL paths or credentials, and known temporary tunnels. Explicit `--allow-http-localhost` runs are local simulations only and do not satisfy production acceptance.

### Remaining external gates

- [x] Owner approved and created the paid single-instance Render Starter service with its 1 GB `/data` disk and exact `PUBLIC_BASE_URL`. Render Hobby logs are retained for seven days; the provider-overwritten `CF-Connecting-IP` source and global backstop passed live spoof tests.
- [ ] Run the documented seed phase against that stable HTTPS origin, restart or redeploy the same service without clearing the disk, and run the documented resume phase with the same mode-`0600` token and receipt files.
- [x] Independently proved hosted persistence before the portal token was available: create Medium Chess, apply `e2e4` exactly once, restart the same Render service without clearing its disk, observe a changed boot identity, and reread version 1 with the same move.
- [ ] Reconnect the stable `/mcp` URL in ChatGPT, refresh metadata to v21, and visibly complete a real player turn plus matching GPT turn on the mounted v21 board. A passing command-line harness or localhost simulation cannot prove this final UI gate.

## Release-readiness refresh — 2026-09-16

### Implemented

- [x] Updated only the affected transitive lockfile entries: `fast-uri` 3.1.5 → 3.1.8, `hono` 4.12.34 → 4.13.8, and `qs` 6.15.3 → 6.16.0. The direct MCP SDK stays at 1.30.0, and widget dependencies are unchanged.
- [x] Corrected README, homepage, and demo instructions to describe the shared local difficulty-aware automatic opponent, versioned host-bridge submissions, and server confirmation. Removed claims that each widget tap triggers a new ChatGPT reasoning turn, candidate comparison, follow-up message, or polling loop.
- [x] Linked the live stable standalone preview and distinguished approved Render hosting from the still-unverified hosted ChatGPT play check and public listing approval.
- [x] Clarified that `get_game_state` and `render_game` perform bounded reads of existing sessions in the app's private game store. Preserved all eight tool annotations, the submission schema, five positive cases, and three negative cases.

### Verification

- [x] Clean `npm ci` succeeds on Node 22.22.0/npm 10.9.4; `npm audit --omit=dev` reports zero known production vulnerabilities.
- [x] `npm run typecheck` passes for the server, web widget, and browser tests.
- [x] `npm run test:ci` passes all 264 server tests and 221 web tests, plus the four-page static-site, local-link, policy, branding, and reviewer-case validation.
- [x] `npm run build` passes both production builds and the unchanged reviewed v21 widget digest check (`298e927861ff…`).
- [x] `npm run test:browser` passes all nine real-browser checks; `git diff --check` passes.
- [x] Structural comparison confirms that the lockfile changes only the three named packages and the submission JSON changes only the two read-tool open-world justifications.
- [ ] Development-only audit follow-up: full `npm audit` reports two moderate entries for Vitest and `@vitest/mocker` under GHSA-82fw-gwwq-j7x9. A test-runner major-version migration is outside this narrow production dependency patch.

### External gates still unverified

- [ ] Final verified publisher/legal identity and remaining policy/contact/retention details. The portal requires verified developer identity before creating or uploading a plugin; no portal draft creation is claimed here.
- [ ] OpenAI domain verification, the live tool scan, and the challenge-bound production seed/resume acceptance run.
- [ ] A fresh mounted ChatGPT player move plus matching automatic opponent move against the stable production endpoint.
- [ ] The final production demo recording and portal asset confirmation.
- [ ] Portal submission, review, and public ChatGPT listing approval.

## Automatic-opponent labels and v22 artifacts — 2026-09-16

### Implemented

- [x] Changed automatic local-engine role, history, score, energy, shot-result, turn, and error labels to `Opponent`, including `Opponent choosing a move…` while a move is pending. Preserved the `gpt` protocol actor, helper names, exact move/receipt behavior, and the real GPT photo-transcription correction instruction.
- [x] Updated existing affected UI/browser assertions without adding prose-only tests, dependencies, schemas, or gameplay changes.
- [x] Published the local build as immutable widget v22 with marker `turnplay-v22-20260916-opponent`; retained v21 through v11 resource aliases and aligned current acceptance scripts, declarations, defaults, errors, and README.
- [x] Built the web workspace before calculating SHA-256 `0990fe5182bce70c3159ff8bb92d4e7e84f2771c078b63776d4bfa902989dee6`, then updated both bundle pins and passed the unchanged validator.

### Verification and capture evidence

- [x] `npm run typecheck`, `npm run test:ci`, `npm run build`, and `npm run test:browser` pass: 264 server tests, 221 web tests, four-page static-site validation, and nine real-browser checks. `git diff --check` passes.
- [x] `node scripts/capture-submission-screenshots.mjs` regenerates all three existing PNGs from the actual built localhost preview with an isolated temporary persistent game store, then closes the browser/server and removes that temporary store. The capture restores only strict v2 `activeGameId` plus draft settings; each reload performs exactly one authoritative state read and no mutations.
- [x] Visually reviewed `01-medium-chess.png` (706×588, Medium, player White), `02-hard-go-9.png` (706×701, Hard, player Black), and `03-imported-go-19.png` (706×824, Hard, player White, Black next, review pending). All board and action controls are present with correct Opponent labels and no runtime errors. The imported capture retains ten setup stones, no legal moves, and disabled board points before review.
- [x] Captures are direct full-page Chromium screenshots, not edited images: Chess/9×9 Go use a 706×560 viewport at device scale 1; imported 19×19 Go uses a 941×760 viewport at device scale 0.75 for the portal's 706-pixel output width. No app CSS was changed for these captures.
- [x] The skill-provided browser-game client produced and visually verified a clean 1280×720 Chess screenshot and matching `render_game_to_text` state, with no error artifact. Its missing external Playwright import was resolved to the repository's existing package at runtime; no dependency changes were made.

### Remaining release gates

- [ ] Independent final specification/code-quality review, merge/push, CI, and stable Render redeployment of v22 remain with the release coordinator.
- [ ] Publisher identity, OpenAI domain verification/tool scan, challenge-bound production seed/resume, mounted ChatGPT gameplay, demo recording, portal submission, and public listing approval remain external gates; localhost checks and prepared files do not prove those outcomes.
