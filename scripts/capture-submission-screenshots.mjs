#!/usr/bin/env node

// Run after npm run build. Captures the real built preview, never production.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { GameStore } from "../server/dist/game-store.js";
import { createHttpApp } from "../server/dist/http-app.js";
import { ToolService } from "../server/dist/tool-service.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "submission", "screenshots");
const saveKey = "gpt-game-arena:standalone-game";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "turnplay-submission-"));
const service = new ToolService(new GameStore({ persistencePath: join(temporaryDirectory, "games.json") }));
const server = createHttpApp(service).listen(0, "127.0.0.1");
let browser;

const cases = [
  { filename: "01-medium-chess.png", tool: "create_game", input: { game: "chess", difficulty: "medium", playerColor: "white" }, draft: { game: "chess", difficulty: "medium", side: "white" }, board: "Chess board" },
  { filename: "02-hard-go-9.png", tool: "create_game", input: { game: "go", boardSize: 9, difficulty: "hard", playerColor: "black" }, draft: { game: "go-9", difficulty: "hard", side: "black" }, board: "9 by 9 Go board" },
  {
    filename: "03-imported-go-19.png", tool: "import_go_position",
    input: { boardSize: 19, difficulty: "hard", playerColor: "white", turn: "black", blackStones: ["D16", "Q16", "D4", "Q4", "F3"], whiteStones: ["K16", "D10", "Q10", "K4", "C3"] },
    draft: { game: "go-19", difficulty: "hard", side: "white" }, board: "19 by 19 Go board",
  },
];

try {
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await mkdir(outputDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true });

  for (const capture of cases) {
    // The imported review uses a wider real viewport; Chromium outputs 706 physical pixels directly.
    const imported = capture.tool === "import_go_position";
    const viewport = imported ? { width: 941, height: 760 } : { width: 706, height: 560 };
    const deviceScaleFactor = imported ? 0.75 : 1;
    const context = await browser.newContext({ viewport, deviceScaleFactor, locale: "en-US", reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(`${origin}/preview`);
      await page.getByRole("group", { name: "Chess board", exact: true }).waitFor();
      const response = await context.request.post(`${origin}/api/tools/${capture.tool}`, { data: capture.input });
      assert(response.ok(), `Fixture ${capture.tool} failed with ${response.status()}.`);
      const result = await response.json();
      assert(!result.isError && result.structuredContent?.gameId, `Fixture ${capture.tool} did not return a game.`);
      const game = result.structuredContent;

      await page.evaluate(({ key, gameId, draft }) => {
        localStorage.setItem(key, JSON.stringify({ formatVersion: 2, activeGameId: gameId, draft }));
      }, { key: saveKey, gameId: game.gameId, draft: capture.draft });
      const restoreCalls = [];
      page.on("request", request => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/tools/")) restoreCalls.push(path);
      });
      await page.reload();
      await page.getByRole("group", { name: capture.board, exact: true }).waitFor();
      await page.waitForFunction(gameId => {
        const state = JSON.parse(window.render_game_to_text());
        return state.game?.gameId === gameId && !state.busy && !state.starting;
      }, game.gameId);
      const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      assert.equal(state.game.stateVersion, 0);
      assert.equal(state.game.playerColor, capture.input.playerColor);
      assert.equal(state.game.difficulty, capture.input.difficulty);
      assert.equal(state.error, undefined);
      assert.deepEqual(restoreCalls, ["/api/tools/get_game_state"]);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey), {
        formatVersion: 2, activeGameId: game.gameId, draft: capture.draft,
      });
      assert.match(await page.locator(".gpt-role").innerText(), /^Opponent is /);
      if (capture.tool === "import_go_position") {
        assert.equal(state.importReview.authoritativeStatus, "pending");
        assert.equal(state.game.turn, "black");
        assert.deepEqual(state.game.legalMoves, []);
        assert.match(await page.locator(".import-review").innerText(), /You: White · Next: Black \(Opponent\)/);
        assert.equal(await page.locator(".go-point:enabled").count(), 0);
      }
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        bottom: document.querySelector(".table").getBoundingClientRect().bottom,
      }));
      assert(geometry.width <= viewport.width && geometry.height * deviceScaleFactor <= 860 && geometry.bottom <= geometry.height, `Capture is clipped: ${JSON.stringify(geometry)}`);
      assert.deepEqual(errors, []);
      const path = join(outputDirectory, capture.filename);
      const png = await page.screenshot({ path, fullPage: true });
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      assert.equal(width, 706);
      assert(height >= 400 && height <= 860);
      console.log(`${path}: ${width}x${height}; ${capture.draft.game}, ${capture.draft.difficulty}, player ${capture.draft.side}; no runtime errors`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  await rm(temporaryDirectory, { recursive: true, force: true });
}
