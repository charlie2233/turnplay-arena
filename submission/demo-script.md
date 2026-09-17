# Turnplay Arena demo recording script

Target a concise three-to-five-minute recording against the final stable production MCP URL. Do not record temporary tunnels, developer secrets, browser account identifiers, personal chats, or terminal environment values.

## Before recording

1. Confirm the GitHub commit matches the deployed revision.
2. Confirm `/health`, `/ready`, and the MCP `initialize` plus `tools/list` flow over public HTTPS.
3. Open a clean ChatGPT conversation with the production app connection.
4. Use a browser window that shows only the product and contains no personal sidebar content.
5. Prepare one non-sensitive 9×9 or 19×19 Go-board image whose stones are easy to verify.

## Recording sequence

1. **Discovery and settings** — Start a Medium Chess game as White. Show the compact board, the game selector, and all three difficulty choices.
2. **Authoritative move** — Play `e2e4`. Explain that the widget's local difficulty-aware engine chooses the automatic opponent reply and submits it through the ChatGPT host tool bridge; it does not request a new model reasoning turn for the tap. Show the stable board layout and the matching saved move/history after the server response with its `MOVE_CONFIRMED` receipt.
3. **Reset confirmation** — Select Reset, cancel once, then confirm. Show preserved Chess/White/Medium settings, an empty board history, and a fresh version.
4. **Go image review** — Attach the prepared image and ask to continue the position with explicit color, next turn, and Hard difficulty. Show the transcribed board and review card before any move is legal. Confirm the review, then play one legal turn.
5. **End confirmation** — Select End Game, show the warning, confirm, and show the frozen board with Reset/Refresh still available.
6. **Resume** — Reload or reopen the same game card and show the same authoritative position returning.
7. **Scope statement** — End on the listing or website and state that the app has no sign-in, payment, prizes, live-sports data, or calibrated Elo rating.

## Evidence to retain privately

- Recording date, production origin, deployment revision, and repository commit.
- MCP Inspector output for `initialize`, `tools/list`, one read, and one mutation.
- The exact positive/negative review cases used.
- A note confirming that no secrets or unrelated personal information appear in the video.
