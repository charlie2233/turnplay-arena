# Turnplay Arena submission source

This file is the human-readable source of truth for the public listing. Portal-only identifiers and verification tokens must not be committed.

## Identity

- Display name: Turnplay Arena
- Category: Entertainment
- Short description: Play turn-based games
- Verified publisher: **REQUIRED BEFORE SUBMISSION**
- Public MCP URL: https://turnplay-arena.onrender.com/mcp
- Website: https://charlie2233.github.io/turnplay-arena/
- Support: https://charlie2233.github.io/turnplay-arena/support.html
- Privacy: https://charlie2233.github.io/turnplay-arena/privacy.html
- Terms: https://charlie2233.github.io/turnplay-arena/terms.html
- Authentication: None
- Demo credentials: None
- Availability: **REQUIRED — select the intended supported regions in Apps Management**

## Long description

Turnplay Arena lets people play Chess, Go, Tic-Tac-Toe, Connect Four, Reversi, Mini 8-Ball, and Court Duel on an interactive board. Choose Easy, Medium, or Hard, play as Black or White, and resume, reset, or end the current session. For Go, attach a board photo or provide stone coordinates, review the transcription, and continue from that position. Difficulty levels use bounded game-specific search and are not calibrated Elo ratings.

## Capabilities

- Play seven turn-based games across nine board presets.
- Choose Easy, Medium, or Hard before starting.
- Review and continue a Go position transcribed from an attached board image.
- Resume, reset, or end the current game session.
- Keep narration synchronized with authoritative move receipts.

## Starter prompts

1. Start a Medium Chess game. I’ll play White.
2. Start a Hard 9×9 Go game. I’ll play Black.
3. Continue this 19×19 Go position from my attached board photo. I’ll play White; Black moves next; use Hard.

The matching real-product captures are `submission/screenshots/01-medium-chess.png`, `02-hard-go-9.png`, and `03-imported-go-19.png`. Each is exactly 706 pixels wide and between 400 and 860 pixels tall.

## Release notes

Initial public submission of Turnplay Arena, an MCP-backed interactive game app. It includes seven game types across nine presets, Easy/Medium/Hard difficulty, reviewed Go-position import, authoritative saved sessions, and confirmation-gated reset and end actions. No sign-in or demo credentials are required. The game server receives transcribed Go coordinates, not uploaded board images.

## Positive reviewer cases

Keep exactly five in the portal payload.

1. Create a Hard 9×9 Go game with the user as Black. Verify board size, difficulty, color, epoch 0, version 0, and legal moves.
2. Import a 9×9 Go position with Black D4/F4, White E4/E5, user as White, Black to move, and Medium. Verify exact stones, pending review, no legal moves, and `IMPORT_CONFIRMED`.
3. Create Hard Tic-Tac-Toe with the user as White. Reuse its returned game ID, epoch, and version; submit GPT move `B2`. Verify one appended move and `MOVE_CONFIRMED`.
4. Create Medium Chess with the user as White. Submit player move `e2e4`, reuse the returned identifiers, then explicitly confirm reset. Verify preserved settings, epoch increment, empty history, version 0, and `RESET_CONFIRMED`.
5. Create Connect Four, reuse its identifiers, then explicitly confirm End Game. Verify the board/history stay intact, status becomes finished, and `END_CONFIRMED` appears.

## Negative reviewer cases

Keep exactly three in the portal payload.

1. “What was the Lakers score last night?” Do not invoke the app; Court Duel is fictional and has no live scores.
2. “Explain why the Sicilian Defense is popular without starting a game.” Do not invoke the app; the user asked only for an explanation.
3. “Book me a table at a nearby pool hall.” Do not invoke the app; Mini 8-Ball does not search or book venues.

## Required attachments and external gates

- Original 512×512 logo and composer icon without OpenAI or GPT marks: `site/assets/logo-512.png` and `site/assets/composer-icon-512.png`.
- Three real screenshots meeting the exact portal dimensions above (prepared in `submission/screenshots/`).
- Short demo recording showing production start/move, difficulty, Go-photo review, reset/end confirmation, and authoritative receipts.
- Verified publisher identity and Apps Management write access.
- Stable production MCP service at `https://turnplay-arena.onrender.com/mcp`: one paid Render Starter instance, a 1 GB persistent disk, 30-day inactive-game expiry, seven-day migration-backup expiry, and seven-day Render Hobby log retention. A create/move/service-restart/resume smoke passed against the same origin on August 8, 2026.
- Domain verification, automated tool scan, hosted ChatGPT acceptance, availability selection, policy attestations, and final release notes.
