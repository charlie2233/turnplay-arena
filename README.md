# Turnplay Arena

Turnplay Arena is a ChatGPT MCP app with a standalone preview. It offers nine presets: Mini 8-Ball, Court Duel basketball, Chess, Tic-Tac-Toe, Connect Four, Reversi, and Go on 9×9, 13×13, or 19×19 boards. The sports games are original designs and do not copy Basketball Stars branding or assets. The React widget is a self-contained `web/dist/index.html`; the Node MCP server serves the current widget at `ui://gpt-game-arena/v22/widget.html` and retains the v21 through v11 resources for historical chats, while `/preview` provides the same UI locally. Internal package, MCP-server, and resource identifiers retain `gpt-game-arena` for compatibility; the public product and repository names do not use the GPT brand.

Public launch materials live in [`site/`](site/) and [`submission/`](submission/). The [public website](https://charlie2233.github.io/turnplay-arena/) and [standalone preview](https://turnplay-arena.onrender.com/preview) are live. The approved single-instance Render service hosts the stable MCP endpoint at `https://turnplay-arena.onrender.com/mcp`; public ChatGPT listing approval and a fresh hosted ChatGPT play check remain separate release gates.

## Architecture

The server is authoritative for all rules and sessions through eight MCP tools: `create_game({ game, playerColor, boardSize?, difficulty? })`, `import_go_position({ boardSize, playerColor, turn, blackStones, whiteStones, captures?, difficulty? })`, the widget-only `confirm_imported_go_position({ gameId, expectedVersion, expectedResetEpoch })`, `get_game_state({ gameId })`, `play_game_move({ gameId, actor, move, expectedVersion, expectedResetEpoch? })`, `end_game({ gameId, confirmed: true, expectedVersion, expectedResetEpoch })`, `reset_game({ gameId, confirmed: true, expectedVersion, expectedResetEpoch })`, and `render_game({ gameId })`. Go accepts `boardSize` 9, 13, or 19 and defaults to 9 when omitted for a normal new game. Difficulty accepts `easy`, `medium`, or `hard` and defaults to `medium`. Successful tool outputs contain the complete authoritative game snapshot, including a `resetEpoch` that starts at 0. New clients send both reset epoch and version so a delayed pre-reset mutation cannot land on a fresh board. For cached older widgets, an omitted move epoch is treated only as epoch 0, so it fails safely after any reset.

For a normal new game, first call `create_game`, then—after its successful confirmed result—call `render_game` exactly once with that exact returned `gameId` to mount the interactive board. `create_game` stays data-only; `render_game` only renders an existing normal game and never creates or mutates it. `import_go_position` is the exception: it owns direct widget rendering for its review flow, so do not call `render_game` again after importing Go.

To continue a photographed Go match, attach the image in ChatGPT and say something like “Continue this 19×19 position; I am White, Black moves next, Hard.” ChatGPT vision transcribes the image into exact uppercase Go coordinates; the server never receives or downloads the image itself. The import tool requires explicit player color and next turn, maps unlabeled images left-to-right from column A and top-to-bottom from the highest rank, and rejects duplicates, overlaps, out-of-range points, or groups that should already be captured. The returned board opens directly with a compact review card and an authoritative `importReview: "pending"` state with no legal moves. Neither the user nor GPT can move until the user selects **Looks right — continue** and the server returns `IMPORT_REVIEW_CONFIRMED`. If a stone is wrong, the user can tell GPT the correction and GPT re-imports one complete corrected position instead of faking setup stones as game moves. An `IMPORT_CONFIRMED` receipt is required before the app claims the position opened.

Moves must be exact `legalMoves` entries: Chess uses long algebraic coordinates such as `e2e4`; Tic-Tac-Toe and Reversi use uppercase squares such as `A1`; Connect Four uses an uppercase column `A`–`G`; Go uses uppercase coordinates such as `D4` (skipping `I`) or `pass`; Mini 8-Ball uses `POT:<ball>:<pocket>` or `SAFE:<zone>`; and Court Duel uses `drive`, `pull-up`, or `three`. Mini 8-Ball assigns Black solids and White stripes: a clear pot keeps the turn, a safety passes it, and clearing the group unlocks the winning 8-ball. Court Duel gives each side five matched regulation shots with public accuracy and energy, followed by at most three matched overtime pairs. Its make/miss sequence is keyed by a persisted server-private per-game seed for reliable replay; neither the seed nor future result rolls appear in snapshots, tool output, the UI, or move strategy. Tic-Tac-Toe ends at three in a row; Connect Four applies gravity and ends at four in a row. Reversi flips bracketed discs, automatically skips a side with no legal move, and finishes with the higher disc score. Go uses positional superko and ends after two consecutive passes.

After a successful player move, both the ChatGPT widget and standalone preview choose automatic opponent replies locally with `chooseStandaloneMove`. The widget submits the chosen exact-legal move through `play_game_move` using the host tool bridge, actor `gpt`, and the authoritative `resetEpoch` and `stateVersion`; the standalone preview uses the same engine through the server's HTTP tool endpoint. The embedded reply is applied only after the authoritative response matches the chosen one-ply advance, or one exact read-only reconciliation confirms it. Successful server moves carry a `MOVE_CONFIRMED` receipt. Rule failures return `MOVE_NOT_APPLIED`; transport or internal ambiguity returns `MOVE_CONFIRMATION_UNKNOWN`, which must never trigger a repeated mutation. Automatic widget turns do not send a follow-up message, request a new ChatGPT reasoning turn per tap, or poll for a model reply. ChatGPT can still operate the game tools in conversation and transcribe Go-board images for import.

The shared deterministic difficulty-aware move engine keeps Easy casual. Medium performs game-aware tactical and positional evaluation. Hard uses complete Tic-Tac-Toe minimax, fixed-depth alpha-beta for Connect Four, mobility-aware alpha-beta plus exact small Reversi endgames, bounded three-ply Chess search reconstructed with `chess.js`, five-ply Mini 8-Ball runout/safety search, and six-ply public-probability Court Duel expectiminimax; Go combines capture/liberty simulation with self-atari, eye-fill, spacing, corner/side development, and whole-board balance. These are bounded interactive engines rather than calibrated Elo-strength opponents. Reversi and Mini 8-Ball can make consecutive automatic opponent turns when the rules leave that side to move again. No `OPENAI_API_KEY` is needed: the widget chooses automatic replies locally, and the server never calls OpenAI.

`reset_game` is destructive and requires explicit confirmation plus the exact current version pair. It increments `resetEpoch` and returns `stateVersion: 0`; the pair `(resetEpoch, stateVersion)` identifies a position without reset/ABA ambiguity. A successful response carries a `RESET_CONFIRMED` receipt. If confirmation is ambiguous, clients perform one read-only reconciliation and never repeat the mutation. Reset preserves the game ID, selected game kind, player color, difficulty, Go board size, and any imported Go root position. Resetting an imported game makes its review pending again before either side can move.

`end_game` is destructive and runs only after the widget's explicit two-step confirmation. It preserves the board and history, records a persisted terminal end event, returns `finishReason: "ended"` with `Game ended.`, and increments `stateVersion` once. A definite refusal returns `END_NOT_APPLIED`; a lost or ambiguous response triggers exactly one read-only state reconciliation and never repeats the end mutation.

The Go engine uses positional superko, two-pass completion, and simplified Chinese-area scoring with 6.5 komi on every board size. A photo cannot recover earlier ko history, passes, or capture totals, so an import deliberately becomes a new superko root; omitted capture totals start at zero. The 19×19 preset is the full standard board, but this demo does not include a tournament dead-stone agreement phase after passing.

## Local commands

```sh
npm install       # or npm ci (Node >=20.19 for this workspace build)
npm test
npm run typecheck
npm run build
npx playwright install chromium # one-time local browser install
npm run test:browser # 9 real-browser checks of the existing build on isolated port 18181
npm run dev       # Node server, then visit /preview
npm run dev:web   # Vite widget development; run npm run dev:server alongside it
npm run preview   # Vite built-widget preview; run npm run dev:server alongside it
```

`npm run test:browser` does not rebuild `web/dist`: it starts the already-built server on isolated port 18181 with a temporary game store and runs Chromium serially across the responsive/gameplay/restore matrix. This keeps the command from changing the widget artifact read by any server already running on port 8000. Run `npm run build` first only when replacing that artifact is intentional; CI builds in its own runner before the browser checks. `npm run test:browser:built` remains as a compatibility alias. Set `PLAYWRIGHT_PORT` to another non-8000 port if 18181 is occupied.

For MCP Inspector, build first, start `npm run dev`, and connect the inspector to `http://localhost:8000/mcp` using Streamable HTTP.

## Production container baseline

The included multi-stage `Dockerfile` builds the React widget and MCP server, runs as the non-root `node` user, exposes port 8000, and stores the authoritative move log at `/data/game-sessions.json`. Production startup fails closed unless both `PUBLIC_BASE_URL` and `GAME_STORE_PATH` are explicit. `PUBLIC_BASE_URL` must be the exact public HTTPS origin and is advertised as the widget's `_meta.ui.domain`.

```sh
docker build -t gpt-game-arena .
docker run --rm -p 8000:8000 \
  -e PUBLIC_BASE_URL=https://games.example.com \
  -e GAME_STORE_PATH=/data/game-sessions.json \
  -v gpt-game-arena-data:/data \
  gpt-game-arena
```

For OpenAI domain verification, temporarily set `OPENAI_APPS_CHALLENGE_TOKEN` to the exact portal-provided token. The server returns it verbatim from `/.well-known/openai-apps-challenge` with caching disabled. Remove the variable after verification unless the portal still requires it.

Deploy this file-backed baseline only as one replica on a host with a real persistent volume mounted at `/data`. Ephemeral filesystems and multiple replicas can lose or split games; use a managed database and distributed rate limiter before autoscaling. Production requires an absolute `GAME_STORE_PATH` and probes and syncs its parent directory before listening, so an unwritable or incompatible target fails startup instead of losing the first write. That probe proves writability, not that a provider actually attached durable storage—the deployment configuration and restart smoke must verify the mount. Keep `/health` for liveness; `/ready` checks both storage writability and widget availability. Production writes sync the temporary file, atomically rename it, and sync the parent directory before success. Structured JSON-line telemetry records only bounded route/tool/outcome/timing fields—never request bodies, moves, game IDs, tokens, or network addresses.

The repository includes a [`render.yaml`](render.yaml) blueprint for the smallest honest stable beta: a paid single Render web service, one instance, and a 1 GB persistent disk at `/data`. After the service has been created intentionally, the Blueprint deploys a pushed revision only after its GitHub checks pass. Set `PUBLIC_BASE_URL` to the exact resulting HTTPS origin. The Render blueprint leaves Express proxy trust disabled and enables the narrowly validated `render-cf-connecting-ip` rate-limit identity source instead. [Render documents](https://render.com/articles/host-pocketbase-on-render#making-pocketbase-see-the-real-client-ip) that Cloudflare overwrites `CF-Connecting-IP` on every public web-service request, while caller-controlled values can remain in `X-Forwarded-For`; startup therefore accepts this mode only when Render's own runtime variables prove that `PUBLIC_BASE_URL` is the exact public `onrender.com` service URL. Missing or malformed trusted headers share one fail-closed bucket, and process-wide caps backstop the per-client limits. Other hosts may configure either `TRUSTED_PROXY_CIDRS` or `TRUST_PROXY_HOPS` only after measuring and spoof-testing their exact topology—never both, and never together with the Render-specific mode. Point the submitted universal MCP URL to the stable public `/mcp` endpoint only after `/health`, `/ready`, persistence across a service restart, the public MCP handshake, and an actual hosted ChatGPT move all pass.

### Stable production acceptance

The two-phase verifier checks one exact v22 production origin before and after a real provider restart. Keep the OpenAI portal challenge configured for both phases. Save the portal token as exactly one non-empty line in a regular, non-symlink file under the ignored `.data/` directory (or outside the repository), then restrict it to mode `0600`. Do not put the token itself in a command, shell history, commit, support message, or acceptance receipt.

```sh
mkdir -p .data
chmod 700 .data
chmod 600 .data/openai-apps-challenge-token.txt

TURNPLAY_PRODUCTION_ORIGIN='https://replace-with-exact-render-origin.onrender.com'
npm run verify:production -- \
  --phase seed \
  --base-url "$TURNPLAY_PRODUCTION_ORIGIN" \
  --state-file .data/production-acceptance-v22.json \
  --require-challenge \
  --challenge-token-file .data/openai-apps-challenge-token.txt
```

The seed phase verifies HTTPS health/readiness, security headers, the exact portal challenge, the reviewed eight-tool MCP catalog, and the v22 widget's exact domain, immutable release marker, MIME type, and pinned SHA-256 bundle digest. Every challenge and MCP response must carry the same non-cacheable process identity as the phase's health/readiness checks, and response bodies are time- and size-bounded. It then creates and renders one Hard Tic-Tac-Toe game, applies player `A3` and GPT `B2` exactly once, verifies the exact reviewed board/legal-move/message snapshot, rereads it authoritatively, and finalizes the private receipt at mode `0600`. The receipt path is atomically reserved before the first network request, so concurrent seeds cannot both mutate a game or overwrite evidence. A failed or interrupted seed leaves that reservation in place; reconcile the ambiguous run before intentionally removing it, and never blindly rerun the seed. The receipt is not an authentication credential, but it contains a private game ID, boot identity, and expected-state digest; keep it out of Git and do not share it.

Next, restart or redeploy the same single Render service without detaching, replacing, or clearing its `/data` disk. After the service is ready, run the resume phase with the same origin, token file, and receipt:

```sh
TURNPLAY_PRODUCTION_ORIGIN='https://replace-with-exact-render-origin.onrender.com'
npm run verify:production -- \
  --phase resume \
  --base-url "$TURNPLAY_PRODUCTION_ORIGIN" \
  --state-file .data/production-acceptance-v22.json \
  --require-challenge \
  --challenge-token-file .data/openai-apps-challenge-token.txt
```

Resume succeeds only when the observed process boot identity changed and the exact seeded game, version, history, render, v22 resource, domain, and challenge survived. This is restart proof only after the provider configuration independently confirms exactly one live service instance; the included Render Blueprint enforces that topology. Running resume against the still-running seed process does not prove a restart, and the verifier rejects phase requests split across different process identities. Real production mode also rejects HTTP, localhost/IP/example origins, redirects, paths, credentials, and known temporary tunnel hosts such as `trycloudflare.com` and `ngrok`; `--allow-http-localhost` exists only for local harness simulation and can never close the hosted production gate.

Even a passing seed/resume pair is endpoint and persistence evidence, not visible ChatGPT acceptance. The paid single-instance Render service and persistent disk are already approved and live. The hosted ChatGPT UI gate still requires reconnecting the stable `/mcp` URL in ChatGPT, refreshing the v22 metadata, and visibly completing a real player move plus matching automatic opponent move on the mounted v22 board.

The Node server persists sessions to the versioned JSON move log at `.data/game-sessions.json` by default. Set `GAME_STORE_PATH` to an absolute path, or to a path relative to the server process working directory, to override it. Saved sessions use a 30-day sliding game-activity window by default; creation, moves, resets, import confirmation, and manual end extend it, while read-only state/render calls do not rewrite the save. A 15-minute maintenance sweep, startup, and later mutations physically prune expired records. Set `GAME_STORE_TTL_MS` to a positive integer number of milliseconds to override it. `GAME_STORE_MAX_SESSIONS` defaults to 1,000 and accepts values up to 10,000. When the active-session limit is full, a new game is refused instead of silently deleting an existing save. Readiness storage probes share one in-flight check and cache its result for 15 seconds. Primary writes and v1 backups use collision-resistant same-directory temporary files, sync the file, rename it atomically, and sync the directory; startup and maintenance remove at most 32 recognized temporary files older than 24 hours per pass. Before upgrading a v1 store to v2, the server keeps an exact mode-`0600` copy at `<GAME_STORE_PATH>.v1.bak`; it is removed after seven days by default, configurable with `GAME_STORE_LEGACY_BACKUP_TTL_MS`. An empty legacy Court Duel can receive a new private outcome seed safely; a played legacy Court Duel that never persisted its seed is retained as explicitly unavailable because its exact prior makes and misses cannot be reconstructed. Such a record returns a safe incompatibility error without blocking other saved games. The server fails startup if an existing file has invalid JSON, an unknown format version, invalid metadata, duplicate IDs, or any other active move history that the rules engine cannot replay.

The widget and standalone `/preview` persist only a strict v2 resume pointer (`activeGameId`) plus the draft game, difficulty, and side selectors. They never cache a board, legal moves, history, message, reset epoch, or state version. On reload, a saved pointer renders no board and permits no board action until one `get_game_state` read returns a validated authoritative snapshot; expired or failed restores clear the pointer and expose the New Game chooser. Legacy snapshot saves are migrated only by extracting their game ID and safe draft preferences, and their cached game state is never rendered.

## ChatGPT developer setup

Enable Developer mode at **Settings → Security and login → Developer mode**, then open **ChatGPT Plugins → plus** to add the server. Serve or tunnel a public HTTPS endpoint ending in `/mcp`, add the plugin/MCP server in ChatGPT, and refresh metadata whenever tools change. See the official [Plugins quickstart](https://developers.openai.com/plugins/quickstart/) and [Connect ChatGPT deployment guide](https://developers.openai.com/plugins/deploy/connect-chatgpt/). The interaction design was inspired by the [OpenAI Apps SDK examples](https://github.com/openai/openai-apps-sdk-examples), especially Cards Against AI.

## Production and demo limits

The local JSON event log survives restarts of one server on one persistent volume, but it is intentionally a single-process store: it provides no file locking, multi-instance coordination, cross-region durability, authenticated ownership, or secure cross-chat saved-game library. Temporary-tunnel ChatGPT acceptance has been completed, and the approved stable Render deployment is live with persistent single-instance storage; a fresh mounted ChatGPT player/opponent turn against that stable endpoint remains unverified. Difficulty uses bounded local search, not a fresh ChatGPT reasoning turn per tap or calibrated Elo ratings. The workspace and server runtime require Node >=20.19; CI and the production container build and run on Node 22.22.0. Public ChatGPT release still requires final publisher/legal identity and policy details, confirmation of host-log and support-ticket retention disclosures, domain verification and the live tool scan, a demo recording, portal submission/review, and the hosted ChatGPT play check.
