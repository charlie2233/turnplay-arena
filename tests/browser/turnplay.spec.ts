import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const SAVE_KEY = "gpt-game-arena:standalone-game";

type RenderedState = {
  mode?: string;
  busy?: boolean;
  starting?: boolean;
  error?: string;
  draft?: { game?: string; difficulty?: string; side?: string };
  game?: {
    gameId?: string;
    resetEpoch?: number;
    kind?: string;
    difficulty?: string;
    playerColor?: string;
    status?: string;
    stateVersion?: number;
    lastMove?: { actor?: string; notation?: string };
  };
};

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function renderedState(page: Page): Promise<RenderedState> {
  return page.evaluate(() => {
    const render = (window as Window & { render_game_to_text?: () => string }).render_game_to_text;
    if (typeof render !== "function") return {};
    return JSON.parse(render()) as RenderedState;
  });
}

async function waitForStandaloneChess(page: Page): Promise<void> {
  await page.goto("/preview");
  await expect(page.getByRole("group", { name: "Chess board" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start game" })).toBeEnabled();
}

async function playStandaloneChessOpening(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^white pawn on e2.*movable source$/ }).click();
  const destination = page.getByRole("button", { name: /^empty e4, legal destination$/ });
  await expect(destination).toBeEnabled();
  await destination.click();
  await expect.poll(async () => {
    const state = await renderedState(page);
    return `${state.game?.stateVersion}:${state.busy}`;
  }).toBe("2:false");
  await expect(page.locator(".history li")).toHaveCount(2);
}

async function createGame(request: APIRequestContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await request.post("/api/tools/create_game", { data: input });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { structuredContent?: unknown };
  expect(body.structuredContent).toBeTruthy();
  return body.structuredContent as Record<string, unknown>;
}

const viewports = [
  { name: "compact phone-width", width: 320, height: 568, minBoard: 220 },
  { name: "standard phone-width", width: 390, height: 844, minBoard: 330 },
  { name: "short landscape pane", width: 416, height: 360, minBoard: 190 },
  { name: "compact ChatGPT pane", width: 700, height: 844, minBoard: 400 },
  { name: "mid-width short pane", width: 800, height: 520, minBoard: 315 },
  { name: "desktop", width: 1280, height: 720, minBoard: 380 },
] as const;

for (const viewport of viewports) {
  test(`chess stays playable in the ${viewport.name} viewport`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForStandaloneChess(page);
    await playStandaloneChessOpening(page);

    await expect(page.locator("#game-preset")).toBeVisible();
    await expect(page.locator("#difficulty-preset")).toBeVisible();
    await expect(page.locator("#side-preset")).toBeVisible();
    await expect(page.getByRole("button", { name: "End game" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reset/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Refresh/ })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const board = document.querySelector<HTMLElement>(".chess-board");
      const controls = document.querySelector<HTMLElement>(".controls-chess");
      const status = document.querySelector<HTMLElement>(".board-chess .game-status");
      if (!board || !controls || !status) throw new Error("Playable chess surface was not rendered.");
      const boardRect = board.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const chooserRects = [...document.querySelectorAll<HTMLElement>(".new-game-picker > *")].map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const overlaps = (left: typeof chooserRects[number], right: typeof chooserRects[number]) => (
        left.left < right.right - 0.5
        && left.right > right.left + 0.5
        && left.top < right.bottom - 0.5
        && left.bottom > right.top + 0.5
      );
      const squares = [...board.querySelectorAll<HTMLElement>("button.square")];
      const hitTargets = squares.every(square => {
        const rect = square.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === square || (hit !== null && square.contains(hit));
      });
      return {
        board: { left: boardRect.left, right: boardRect.right, top: boardRect.top, bottom: boardRect.bottom, width: boardRect.width, height: boardRect.height },
        controls: { left: controlsRect.left, right: controlsRect.right, top: controlsRect.top, bottom: controlsRect.bottom },
        status: { left: statusRect.left, right: statusRect.right, top: statusRect.top, bottom: statusRect.bottom },
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        squareCount: squares.length,
        hitTargets,
        chooserWithinViewport: chooserRects.every(rect => rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1),
        chooserOverlaps: chooserRects.some((rect, index) => chooserRects.slice(index + 1).some(other => overlaps(rect, other))),
        scrollY: window.scrollY,
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    for (const rect of [geometry.board, geometry.controls, geometry.status]) {
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    }
    expect(Math.abs(geometry.board.width - geometry.board.height)).toBeLessThanOrEqual(1);
    expect(geometry.board.width).toBeGreaterThanOrEqual(viewport.minBoard);
    expect(geometry.squareCount).toBe(64);
    expect(geometry.hitTargets).toBe(true);
    expect(geometry.chooserWithinViewport).toBe(true);
    expect(geometry.chooserOverlaps).toBe(false);
    expect(geometry.scrollY).toBe(0);
    expect(runtimeErrors).toEqual([]);
  });
}

test("Hard Tic-Tac-Toe as White keeps settings and a confirmed GPT opening after Try again", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const toolCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/tools/")) return;
    let body: Record<string, unknown> = {};
    try { body = request.postDataJSON() as Record<string, unknown>; } catch { /* The assertion below reports an unexpected body. */ }
    toolCalls.push({ path, body });
  });
  await page.setViewportSize({ width: 416, height: 360 });
  await waitForStandaloneChess(page);
  toolCalls.length = 0;

  await page.locator("#game-preset").selectOption("tic-tac-toe");
  await page.locator("#difficulty-preset").selectOption("hard");
  await page.locator("#side-preset").selectOption("white");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByRole("group", { name: "Tic-Tac-Toe board" })).toBeVisible();

  await expect.poll(async () => (await renderedState(page)).game?.stateVersion).toBe(1);
  const opened = await renderedState(page);
  expect(opened.game).toMatchObject({
    kind: "tic-tac-toe",
    difficulty: "hard",
    playerColor: "white",
    status: "active",
    stateVersion: 1,
  });
  expect(opened.game?.lastMove).toMatchObject({ actor: "gpt", notation: "B2" });
  await expect(page.locator(".history li")).toHaveCount(1);
  await expect(page.locator(".history li")).toContainText("B2 · Opponent");
  const gameId = opened.game?.gameId;
  const resetEpoch = opened.game?.resetEpoch ?? 0;
  expect(gameId).toBeTruthy();

  await page.getByRole("button", { name: /^A3, empty, legal move$/ }).click();
  await expect.poll(async () => (await renderedState(page)).game?.stateVersion).toBe(3);
  await expect(page.locator(".history li")).toHaveCount(3);
  await expect(page.locator(".history li").nth(1)).toContainText("A3 · Player");
  expect((await renderedState(page)).game?.lastMove?.actor).toBe("gpt");

  await page.getByRole("button", { name: "End game" }).click();
  const endDialog = page.getByRole("alertdialog");
  await expect(endDialog).toBeVisible();
  await endDialog.getByRole("button", { name: "End game", exact: true }).click();
  await expect.poll(async () => (await renderedState(page)).game?.status).toBe("finished");

  await page.getByRole("button", { name: /Try again/ }).click();
  const resetDialog = page.getByRole("alertdialog");
  await expect(resetDialog).toBeVisible();
  const compactConfirmation = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>(".tic-board")?.getBoundingClientRect();
    const dialog = document.querySelector<HTMLElement>(".end-confirmation")?.getBoundingClientRect();
    const status = document.querySelector<HTMLElement>(".board-tic-tac-toe .game-status")?.getBoundingClientRect();
    const actions = [...document.querySelectorAll<HTMLElement>(".end-confirmation-actions button")].map(element => element.getBoundingClientRect());
    if (!board || !dialog || !status || actions.length !== 2) throw new Error("Compact confirmation surface was incomplete.");
    const overlaps = (left: DOMRect, right: DOMRect) => left.left < right.right - 0.5 && left.right > right.left + 0.5 && left.top < right.bottom - 0.5 && left.bottom > right.top + 0.5;
    return {
      allInsideViewport: [board, dialog, status, ...actions].every(rect => rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1),
      boardDialogOverlap: overlaps(board, dialog),
      actionOverlap: overlaps(actions[0]!, actions[1]!),
      scrollY: window.scrollY,
    };
  });
  expect(compactConfirmation).toEqual({ allInsideViewport: true, boardDialogOverlap: false, actionOverlap: false, scrollY: 0 });

  await resetDialog.getByRole("button", { name: "Keep playing", exact: true }).click();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeFocused();
  expect((await renderedState(page)).game).toMatchObject({ gameId, resetEpoch, status: "finished", stateVersion: 4 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(toolCalls).toHaveLength(5);

  await page.locator("#game-preset").selectOption("chess");
  await page.locator("#difficulty-preset").selectOption("easy");
  await page.locator("#side-preset").selectOption("black");

  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(resetDialog).toBeVisible();
  await resetDialog.getByRole("button", { name: "Try again", exact: true }).click();

  await expect.poll(async () => {
    const state = await renderedState(page);
    return `${state.game?.status}:${state.game?.resetEpoch}:${state.game?.stateVersion}:${state.busy}`;
  }).toBe(`active:${resetEpoch + 1}:1:false`);

  const retried = await renderedState(page);
  expect(retried.draft).toEqual({ game: "chess", difficulty: "easy", side: "black" });
  expect(retried.game).toMatchObject({
    gameId,
    resetEpoch: resetEpoch + 1,
    kind: "tic-tac-toe",
    difficulty: "hard",
    playerColor: "white",
    status: "active",
    stateVersion: 1,
  });
  expect(retried.game?.lastMove).toMatchObject({ actor: "gpt", notation: "B2" });
  await expect(page.locator(".history li")).toHaveCount(1);
  await expect(page.locator(".history li")).toContainText("B2 · Opponent");
  await expect(page.locator("#game-preset")).toHaveValue("chess");
  await expect(page.locator("#difficulty-preset")).toHaveValue("easy");
  await expect(page.locator("#side-preset")).toHaveValue("black");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  expect(toolCalls.map(call => call.path)).toEqual([
    "/api/tools/create_game",
    "/api/tools/play_game_move",
    "/api/tools/play_game_move",
    "/api/tools/play_game_move",
    "/api/tools/end_game",
    "/api/tools/reset_game",
    "/api/tools/play_game_move",
  ]);
  expect(toolCalls[0]?.body).toEqual({ game: "tic-tac-toe", playerColor: "white", difficulty: "hard" });
  expect(toolCalls[1]?.body).toEqual({ gameId, actor: "gpt", move: "B2", expectedVersion: 0, expectedResetEpoch: 0 });
  expect(toolCalls[2]?.body).toEqual({ gameId, actor: "player", move: "A3", expectedVersion: 1, expectedResetEpoch: 0 });
  expect(toolCalls[3]?.body).toMatchObject({ gameId, actor: "gpt", expectedVersion: 2, expectedResetEpoch: 0 });
  expect(toolCalls[4]?.body).toEqual({ gameId, confirmed: true, expectedVersion: 3, expectedResetEpoch: 0 });
  expect(toolCalls[5]?.body).toEqual({ gameId, confirmed: true, expectedVersion: 4, expectedResetEpoch: 0 });
  expect(toolCalls[6]?.body).toEqual({ gameId, actor: "gpt", move: "B2", expectedVersion: 0, expectedResetEpoch: 1 });

  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), SAVE_KEY);
  expect(persisted).toEqual({
    formatVersion: 2,
    activeGameId: gameId,
    draft: { game: "chess", difficulty: "easy", side: "black" },
  });
  expect(runtimeErrors).toEqual([]);
});

test("pointer-only saved state exposes no cached board while one authoritative restore is pending", async ({ page, request }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const snapshot = await createGame(request, { game: "chess", playerColor: "white", difficulty: "medium" });
  const gameId = snapshot.gameId;
  expect(typeof gameId).toBe("string");

  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SAVE_KEY,
    value: { formatVersion: 2, activeGameId: gameId, draft: { game: "chess", difficulty: "medium", side: "white" } },
  });

  let restoreCalls = 0;
  const pageToolCalls: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/tools/")) pageToolCalls.push(path);
  });
  let releaseRestore!: () => void;
  let markRestoreStarted!: () => void;
  const restoreGate = new Promise<void>(resolve => { releaseRestore = resolve; });
  const restoreStarted = new Promise<void>(resolve => { markRestoreStarted = resolve; });
  await page.route("**/api/tools/get_game_state", async route => {
    restoreCalls += 1;
    markRestoreStarted();
    await restoreGate;
    await route.continue();
  });

  try {
    await page.goto("/preview");
    await restoreStarted;
    await expect(page.getByRole("status")).toHaveText("Restoring saved game…");
    await expect(page.getByRole("group", { name: "Chess board" })).toHaveCount(0);
    await expect(page.locator(".table")).toHaveCount(0);

    const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), SAVE_KEY);
    expect(persisted).toEqual({
      formatVersion: 2,
      activeGameId: gameId,
      draft: { game: "chess", difficulty: "medium", side: "white" },
    });
    expect(JSON.stringify(persisted)).not.toMatch(/board|legalMoves|moveHistory|stateVersion|message/);
  } finally {
    releaseRestore();
  }
  await expect(page.getByRole("group", { name: "Chess board" })).toBeVisible();
  await expect.poll(async () => (await renderedState(page)).game?.gameId).toBe(gameId);
  const restored = await renderedState(page);
  expect(restored.game).toMatchObject({
    gameId,
    kind: "chess",
    difficulty: "medium",
    playerColor: "white",
    status: "active",
    stateVersion: 0,
  });
  expect(restoreCalls).toBe(1);
  expect(pageToolCalls).toEqual(["/api/tools/get_game_state"]);
  expect(runtimeErrors).toEqual([]);
});
