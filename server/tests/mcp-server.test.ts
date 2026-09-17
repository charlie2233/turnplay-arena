import { readFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Ajv } from "ajv";
import { describe, expect, it, vi } from "vitest";

import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import {
  validateNegativeWorkflows,
  validatePositiveWorkflows,
  type SubmissionWorkflowCase,
} from "../../scripts/submission-workflow-validation.mjs";

import { createMcpServer, LEGACY_WIDGET_RESOURCE_URIS, WIDGET_DESCRIPTION, WIDGET_RESOURCE_URI } from "../src/mcp-server.js";
import { gameSnapshotSchema, toolInputSchemas } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import type { OperationalEvent } from "../src/telemetry.js";
import { ToolService } from "../src/tool-service.js";

describe("MCP game arena server", () => {
  it("keeps the reviewer submission manifest complete and bounded", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../chatgpt-app-submission.json", import.meta.url), "utf8")) as {
      app_info?: { display_name?: string; subtitle?: string };
      tools?: Record<string, { annotations?: Record<string, boolean> }>;
      test_cases?: SubmissionWorkflowCase[];
      negative_test_cases?: Array<{ tools_triggered?: unknown }>;
    };
    expect(Object.keys(manifest.tools ?? {}).sort()).toEqual([
      "confirm_imported_go_position", "create_game", "end_game", "get_game_state", "import_go_position", "play_game_move", "render_game", "reset_game",
    ]);
    expect(manifest.app_info?.subtitle?.length).toBeLessThanOrEqual(30);
    expect(manifest.app_info?.display_name).toBe("Turnplay Arena");
    expect(manifest.test_cases).toHaveLength(5);
    const positiveCases = manifest.test_cases ?? [];
    expect(validatePositiveWorkflows(positiveCases, new Set(Object.keys(manifest.tools ?? {})))).toEqual([]);
    expect(validateNegativeWorkflows(manifest.negative_test_cases ?? [])).toEqual([]);
    for (const tool of Object.values(manifest.tools ?? {})) {
      expect(Object.keys(tool.annotations ?? {}).sort()).toEqual(["destructiveHint", "openWorldHint", "readOnlyHint"]);
    }
  });

  it.each([
    ["blank segment", 0, "create_game, , render_game", "contains a blank tool segment"],
    ["unknown tool", 0, "create_game, render_game, unknown_tool", "unknown tool token unknown_tool"],
    ["duplicate create", 0, "create_game, create_game, render_game", "duplicate tool token create_game"],
    ["duplicate render", 0, "create_game, render_game, render_game", "duplicate tool token render_game"],
    ["intervening tool", 0, "create_game, get_game_state, render_game", "render_game must appear immediately after create_game"],
    ["state prefix", 0, "get_game_state, create_game, render_game", "create_game must be the first tool"],
    ["move prefix", 0, "play_game_move, create_game, render_game", "create_game must be the first tool"],
    ["render-only positive", 0, "render_game", "workflow must start from create_game or import_go_position"],
    ["null positive", 0, null, "tools_triggered must be a nonempty string"],
    ["mixed import/create/render", 1, "import_go_position, create_game, render_game", "import workflow must contain only import_go_position"],
  ] as const)("rejects a %s reviewer workflow", async (_label, caseIndex, toolsTriggered, expectedError) => {
    const manifest = JSON.parse(await readFile(new URL("../../chatgpt-app-submission.json", import.meta.url), "utf8")) as {
      tools?: Record<string, unknown>;
      test_cases?: SubmissionWorkflowCase[];
    };
    const fixture = (manifest.test_cases ?? []).map(testCase => ({ ...testCase }));
    fixture[caseIndex] = { ...fixture[caseIndex], tools_triggered: toolsTriggered };
    expect(validatePositiveWorkflows(fixture, new Set(Object.keys(manifest.tools ?? {}))).join("\n")).toContain(expectedError);
  });

  it("registers eight game tools and the widget resource", async () => {
    expect(WIDGET_RESOURCE_URI).toBe("ui://gpt-game-arena/v22/widget.html");
    expect(LEGACY_WIDGET_RESOURCE_URIS).toEqual(["ui://gpt-game-arena/v21/widget.html", "ui://gpt-game-arena/v20/widget.html", "ui://gpt-game-arena/v19/widget.html", "ui://gpt-game-arena/v18/widget.html", "ui://gpt-game-arena/v17/widget.html", "ui://gpt-game-arena/v16/widget.html", "ui://gpt-game-arena/v15/widget.html", "ui://gpt-game-arena/v14/widget.html", "ui://gpt-game-arena/v13/widget.html", "ui://gpt-game-arena/v12/widget.html", "ui://gpt-game-arena/v11/widget.html"]);
    expect(WIDGET_DESCRIPTION).toContain("Mini 8-Ball");
    expect(WIDGET_DESCRIPTION).toContain("Court Duel");
    expect(WIDGET_DESCRIPTION).toContain("chess");
    expect(WIDGET_DESCRIPTION).toContain("Reversi");
    expect(WIDGET_DESCRIPTION).toContain("Tic-Tac-Toe");
    expect(WIDGET_DESCRIPTION).toContain("Connect Four");
    expect(WIDGET_DESCRIPTION).toContain("9x9, 13x13, or 19x19 Go");
    const server = createMcpServer(new ToolService(new GameStore()), {
      loadWidgetHtml: () => "<!doctype html><title>fixture</title>",
      widgetDomain: "https://games.example.com",
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "confirm_imported_go_position", "create_game", "end_game", "get_game_state", "import_go_position", "play_game_move", "render_game", "reset_game",
    ]);
    const expectedAnnotations = {
      create_game: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      import_go_position: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      confirm_imported_go_position: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      get_game_state: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      play_game_move: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      end_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
      reset_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
      render_game: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    } as const;
    for (const tool of tools.tools) {
      expect(tool.description).toMatch(/^Use this when/);
      expect(tool.annotations).toMatchObject(expectedAnnotations[tool.name as keyof typeof expectedAnnotations]);
      expect(tool._meta).toMatchObject({
        "openai/toolInvocation/invoking": "Working…",
        "openai/toolInvocation/invoked": "Done.",
      });
    }
    const rendered = tools.tools.find((tool) => tool.name === "render_game");
    expect(rendered).toMatchObject({
      title: "Render game",
      _meta: { ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] }, "openai/outputTemplate": WIDGET_RESOURCE_URI },
    });
    const importedTool = tools.tools.find((tool) => tool.name === "import_go_position");
    expect(importedTool).toMatchObject({
      title: "Continue Go from a photo",
      _meta: { ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] }, "openai/outputTemplate": WIDGET_RESOURCE_URI },
    });
    expect(importedTool?.description).toContain("attached board image");
    expect(importedTool?.description).toContain("I am White");
    expect(importedTool?.description).toContain("you/GPT are White");
    expect(importedTool?.description).toContain("ask one concise question");
    expect(importedTool?.description).toContain("IMPORT_CONFIRMED");
    expect(importedTool?.description).toContain("do not make a game move until");
    const confirmImportTool = tools.tools.find((tool) => tool.name === "confirm_imported_go_position");
    expect(confirmImportTool).toMatchObject({
      title: "Confirm imported Go position",
      _meta: { ui: { visibility: ["app"] } },
    });
    expect(confirmImportTool?.description).toContain("user clicks");
    expect(confirmImportTool?.description).toContain("IMPORT_REVIEW_CONFIRMED");
    expect(confirmImportTool?.description).toContain("IMPORT_REVIEW_CONFIRMATION_UNKNOWN");
    expect(tools.tools.find((tool) => tool.name === "create_game")?.title).toBe("Create game");
    expect(tools.tools.find((tool) => tool.name === "get_game_state")?.title).toBe("Get game state");
    expect(tools.tools.find((tool) => tool.name === "play_game_move")?.title).toBe("Play game move");
    expect(tools.tools.find((tool) => tool.name === "play_game_move")?.description).toContain("MOVE_CONFIRMED");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.title).toBe("End game");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.description).toContain("explicitly confirms");
    expect(tools.tools.find((tool) => tool.name === "end_game")?.description).toContain("END_CONFIRMED");
    expect(tools.tools.find((tool) => tool.name === "reset_game")?.title).toBe("Reset game");
    expect(tools.tools.find((tool) => tool.name === "reset_game")?.description).toContain("explicitly confirms");
    expect(tools.tools.find((tool) => tool.name === "reset_game")?.description).toContain("RESET_CONFIRMED");
    expect(tools.tools.find((tool) => tool.name === "reset_game")?.description).toContain("RESET_CONFIRMATION_UNKNOWN");
    const createTool = tools.tools.find((tool) => tool.name === "create_game");
    expect(createTool?.description).toContain("After a successful confirmed create, call render_game exactly once with the returned gameId to show the interactive board.");
    expect(createTool?._meta).not.toHaveProperty("ui.resourceUri");
    expect(createTool?._meta).not.toHaveProperty("openai/outputTemplate");
    expect(rendered?.description).toContain("Use this when performing the UI render step for an existing normal game, especially immediately after create_game.");
    expect(rendered?.description).toContain("Use the exact gameId returned by create_game and call it once.");
    expect(rendered?.description).toContain("This tool does not create or mutate a game.");
    expect(rendered?.description).toContain("Do not call it after import_go_position because that tool owns the widget render.");
    for (const game of ["Mini 8-Ball", "Court Duel", "chess", "Reversi", "Tic-Tac-Toe", "Connect Four", "Go"]) {
      expect(createTool?.description).toContain(game);
    }
    expect(createTool?.description).toContain("omitted difficulty defaults to medium");
    expect(createTool?.inputSchema).toMatchObject({
      properties: {
        game: { enum: ["chess", "go", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"] },
        boardSize: { enum: [9, 13, 19] },
        difficulty: { enum: ["easy", "medium", "hard"], default: "medium" },
      },
    });
    expect((createTool?.inputSchema as { required?: string[] }).required).not.toContain("difficulty");
    const validateCreateInput = new Ajv({ strict: false }).compile(createTool?.inputSchema as object);
    expect(toolInputSchemas.create_game.shape.game.options).toEqual(["chess", "go", "tic-tac-toe", "connect-four", "reversi", "pool", "basketball"]);
    expect(toolInputSchemas.create_game.safeParse({ game: "tic-tac-toe", playerColor: "black" }).success).toBe(true);
    expect(toolInputSchemas.create_game.safeParse({ game: "connect-four", playerColor: "black" }).success).toBe(true);
    expect(validateCreateInput({ game: "go", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "tic-tac-toe", playerColor: "black" })).toBe(true);
    for (const difficulty of ["easy", "medium", "hard"]) {
      expect(validateCreateInput({ game: "chess", playerColor: "white", difficulty })).toBe(true);
    }
    for (const boardSize of [9, 13, 19]) {
      expect(validateCreateInput({ game: "go", playerColor: "black", boardSize })).toBe(true);
    }
    for (const difficulty of ["Medium", "expert", "", 1, null]) {
      expect(validateCreateInput({ game: "chess", playerColor: "white", difficulty })).toBe(false);
    }
    expect(validateCreateInput({ game: "go", playerColor: "black", boardSize: 10 })).toBe(false);
    expect(validateCreateInput({ game: "connect-four", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "reversi", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "pool", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "basketball", playerColor: "black" })).toBe(true);
    expect(validateCreateInput({ game: "go", playerColor: "black", boardSize: 19, secret: "SECRET" })).toBe(false);
    expect(tools.tools.filter((tool) => tool.name !== "render_game" && tool.name !== "import_go_position" && tool.name !== "confirm_imported_go_position").every((tool) => {
      const meta = tool._meta as { ui?: { resourceUri?: string; visibility?: string[] }; "openai/outputTemplate"?: string } | undefined;
      return meta?.ui?.resourceUri === undefined
        && meta?.["openai/outputTemplate"] === undefined
        && JSON.stringify(meta?.ui?.visibility) === JSON.stringify(["model", "app"]);
    })).toBe(true);
    const validateImportInput = new Ajv({ strict: false }).compile(importedTool?.inputSchema as object);
    for (const input of [
      { boardSize: 9, playerColor: "white", turn: "white", blackStones: ["D4"], whiteStones: ["E5"] },
      { boardSize: 13, playerColor: "black", turn: "white", blackStones: ["N13"], whiteStones: ["J1"], difficulty: "hard" },
      { boardSize: 19, playerColor: "white", turn: "black", blackStones: ["T19"], whiteStones: ["K10"], captures: { black: 2, white: 3 } },
    ]) expect(validateImportInput(input), JSON.stringify(validateImportInput.errors)).toBe(true);
    for (const input of [
      { boardSize: 9, playerColor: "white", turn: "white", blackStones: ["I4"], whiteStones: [] },
      { boardSize: 9, playerColor: "white", turn: "white", blackStones: ["A10"], whiteStones: [] },
      { boardSize: 13, playerColor: "white", turn: "white", blackStones: ["N14"], whiteStones: [] },
      { boardSize: 19, playerColor: "white", turn: "white", blackStones: ["U1"], whiteStones: [] },
      { boardSize: 9, playerColor: "white", blackStones: [], whiteStones: [] },
      { boardSize: 9, playerColor: "white", turn: "white", blackStones: [], whiteStones: [], secret: "SECRET" },
    ]) expect(validateImportInput(input)).toBe(false);
    expect(JSON.stringify(tools.tools).length).toBeLessThan(30_000);
    for (const tool of tools.tools) {
      const outputSchema = tool.outputSchema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
      expect(outputSchema).toMatchObject({
        type: "object",
        properties: {
          gameId: expect.any(Object),
          kind: expect.any(Object),
          difficulty: expect.any(Object),
          playerColor: expect.any(Object),
          turn: expect.any(Object),
          status: expect.any(Object),
          stateVersion: expect.any(Object),
          message: expect.any(Object),
          legalMoves: expect.any(Object),
          moveHistory: expect.any(Object),
          board: expect.any(Object),
          boardSize: expect.any(Object),
          importReview: expect.any(Object),
          score: expect.any(Object),
          balls: expect.any(Object),
          shotResults: expect.any(Object),
        },
      });
      expect(outputSchema.required).toEqual(expect.arrayContaining([
        "gameId", "kind", "difficulty", "playerColor", "turn", "status", "stateVersion", "resetEpoch", "message", "legalMoves", "moveHistory",
      ]));
    }
    const playTool = tools.tools.find((tool) => tool.name === "play_game_move");
    expect(playTool?.inputSchema).toMatchObject({ properties: { expectedResetEpoch: { type: "integer", minimum: 0 } } });
    expect((playTool?.inputSchema as { required?: string[] }).required).not.toContain("expectedResetEpoch");
    expect(confirmImportTool?.inputSchema).toMatchObject({
      properties: {
        gameId: expect.any(Object),
        expectedVersion: { type: "integer", minimum: 0 },
        expectedResetEpoch: { type: "integer", minimum: 0 },
      },
      required: expect.arrayContaining(["gameId", "expectedVersion", "expectedResetEpoch"]),
      additionalProperties: false,
    });
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({ gameId: "game", expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(true);
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({ gameId: "game", expectedVersion: 0 }).success).toBe(false);
    expect(toolInputSchemas.confirm_imported_go_position.safeParse({ gameId: "game", expectedVersion: 0, expectedResetEpoch: 0, confirmed: true }).success).toBe(false);
    const endTool = tools.tools.find((tool) => tool.name === "end_game");
    expect(endTool?.inputSchema).toMatchObject({
      properties: {
        confirmed: { const: true },
        expectedVersion: { type: "integer", minimum: 0 },
        expectedResetEpoch: { type: "integer", minimum: 0 },
      },
      required: expect.arrayContaining(["gameId", "confirmed", "expectedVersion", "expectedResetEpoch"]),
    });
    expect((endTool?.inputSchema as { properties?: Record<string, unknown> }).properties).not.toHaveProperty("actor");
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(true);
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: false, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(false);
    expect(toolInputSchemas.end_game.safeParse({ gameId: "game", confirmed: true, expectedVersion: 0 }).success).toBe(false);
    const resetTool = tools.tools.find((tool) => tool.name === "reset_game");
    expect(resetTool?.inputSchema).toMatchObject({
      properties: {
        confirmed: { const: true },
        expectedVersion: { type: "integer", minimum: 0 },
        expectedResetEpoch: { type: "integer", minimum: 0 },
      },
      required: expect.arrayContaining(["gameId", "confirmed", "expectedVersion", "expectedResetEpoch"]),
      additionalProperties: false,
    });
    expect(toolInputSchemas.reset_game.safeParse({ gameId: "game", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(true);
    expect(toolInputSchemas.reset_game.safeParse({ gameId: "game", expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(false);
    expect(toolInputSchemas.reset_game.safeParse({ gameId: "game", confirmed: false, expectedVersion: 0, expectedResetEpoch: 0 }).success).toBe(false);

    const created = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(created.isError, JSON.stringify(created)).not.toBe(true);
    const snapshot = created.structuredContent as {
      gameId: string;
      kind: string;
      difficulty: string;
      resetEpoch: number;
    };
    expect(snapshot.kind).toBe("chess");
    expect(snapshot.difficulty).toBe("medium");
    expect(snapshot.resetEpoch).toBe(0);
    expect(gameSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const goCreated = await client.callTool({ name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 19, difficulty: "hard" } });
    const goSnapshot = goCreated.structuredContent as Record<string, unknown>;
    expect(goSnapshot.kind).toBe("go");
    expect(goSnapshot.difficulty).toBe("hard");
    expect(goSnapshot.boardSize).toBe(19);
    expect(goSnapshot.board).toHaveLength(19);
    const goBoard = goSnapshot.board as unknown[][];
    const imported = await client.callTool({ name: "import_go_position", arguments: {
      boardSize: 9,
      playerColor: "white",
      turn: "white",
      blackStones: ["D4", "J9"],
      whiteStones: ["E4", "E5"],
      difficulty: "hard",
    } });
    expect(imported.isError, JSON.stringify(imported)).not.toBe(true);
    const importedContent = imported.content as Array<{ type: string; text?: string }> | undefined;
    expect(importedContent?.[0]).toMatchObject({ type: "text", text: expect.stringMatching(/^IMPORT_CONFIRMED /) });
    expect(imported.structuredContent).toMatchObject({
      kind: "go",
      boardSize: 9,
      playerColor: "white",
      turn: "white",
      difficulty: "hard",
      stateVersion: 0,
      importReview: "pending",
      legalMoves: [],
      moveHistory: [],
      initialPosition: { source: "imported", blackStones: ["D4", "J9"], whiteStones: ["E4", "E5"] },
    });
    expect(gameSnapshotSchema.safeParse(imported.structuredContent).success).toBe(true);
    expect(gameSnapshotSchema.safeParse({ ...(imported.structuredContent as object), importReview: undefined }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...(goSnapshot as object), importReview: "pending" }).success).toBe(false);
    const importedGameId = (imported.structuredContent as { gameId: string }).gameId;
    const blockedImportedMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: importedGameId, actor: "player", move: "A1", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(blockedImportedMove).toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/^MOVE_NOT_APPLIED import_review_required:/) }],
    });
    const confirmedImport = await client.callTool({ name: "confirm_imported_go_position", arguments: {
      gameId: importedGameId, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(confirmedImport.isError, JSON.stringify(confirmedImport)).not.toBe(true);
    expect(confirmedImport.structuredContent).toMatchObject({
      gameId: importedGameId,
      stateVersion: 1,
      resetEpoch: 0,
      importReview: "confirmed",
    });
    expect(confirmedImport.content).toEqual([{ type: "text", text: `IMPORT_REVIEW_CONFIRMED ${JSON.stringify({
      gameId: importedGameId,
      resetEpoch: 0,
      previousVersion: 0,
      stateVersion: 1,
      importReview: "confirmed",
    })}` }]);
    const repeatedImportConfirmation = await client.callTool({ name: "confirm_imported_go_position", arguments: {
      gameId: importedGameId, expectedVersion: 1, expectedResetEpoch: 0,
    } });
    expect(repeatedImportConfirmation).toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/^IMPORT_REVIEW_NOT_APPLIED import_review_unavailable:/) }],
    });
    const playedImportedMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: importedGameId, actor: "player", move: "A1", expectedVersion: 1, expectedResetEpoch: 0,
    } });
    expect(playedImportedMove).toMatchObject({
      structuredContent: { gameId: importedGameId, stateVersion: 2, importReview: "confirmed" },
      content: [{ text: expect.stringMatching(/^MOVE_CONFIRMED /) }],
    });
    const resetImported = await client.callTool({ name: "reset_game", arguments: {
      gameId: importedGameId, confirmed: true, expectedVersion: 2, expectedResetEpoch: 0,
    } });
    expect(resetImported.structuredContent).toMatchObject({
      gameId: importedGameId,
      stateVersion: 0,
      resetEpoch: 1,
      importReview: "pending",
      legalMoves: [],
      moveHistory: [],
    });
    const staleEpochConfirmation = await client.callTool({ name: "confirm_imported_go_position", arguments: {
      gameId: importedGameId, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(staleEpochConfirmation).toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/^IMPORT_REVIEW_NOT_APPLIED stale_version:/) }],
    });
    const ticTacToeCreated = await client.callTool({ name: "create_game", arguments: { game: "tic-tac-toe", playerColor: "black" } });
    const ticTacToeSnapshot = ticTacToeCreated.structuredContent as Record<string, unknown>;
    expect(ticTacToeSnapshot).toMatchObject({ kind: "tic-tac-toe", difficulty: "medium" });
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, legalMoves: ["a1"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, legalMoves: ["D1"] }).success).toBe(false);
    const ticMove = { actor: "player", color: "black", notation: "A1", ply: 1 };
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, moveHistory: [ticMove], lastMove: ticMove }).success).toBe(true);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, moveHistory: [{ ...ticMove, notation: "a1" }] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...ticTacToeSnapshot, lastMove: { ...ticMove, notation: "D1" } }).success).toBe(false);
    const connectFourCreated = await client.callTool({ name: "create_game", arguments: { game: "connect-four", playerColor: "black" } });
    const connectFourSnapshot = connectFourCreated.structuredContent as Record<string, unknown>;
    expect(connectFourSnapshot).toMatchObject({ kind: "connect-four", difficulty: "medium" });
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, legalMoves: ["a"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, board: [] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, winningLine: ["A1", "B1", "C1"] }).success).toBe(false);
    const connectMove = { actor: "player", color: "black", notation: "A", ply: 1 };
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, moveHistory: [connectMove], lastMove: connectMove }).success).toBe(true);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, moveHistory: [{ ...connectMove, notation: "a" }] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...connectFourSnapshot, lastMove: { ...connectMove, notation: "H" } }).success).toBe(false);
    const reversiCreated = await client.callTool({ name: "create_game", arguments: { game: "reversi", playerColor: "black" } });
    const reversiSnapshot = reversiCreated.structuredContent as Record<string, unknown>;
    expect(reversiCreated.isError, JSON.stringify(reversiCreated)).not.toBe(true);
    expect(reversiSnapshot).toMatchObject({ kind: "reversi", score: { black: 2, white: 2 }, legalMoves: ["C4", "D3", "E6", "F5"] });
    const poolCreated = await client.callTool({ name: "create_game", arguments: { game: "pool", playerColor: "black", difficulty: "hard" } });
    const poolSnapshot = poolCreated.structuredContent as Record<string, unknown>;
    expect(poolCreated.isError, JSON.stringify(poolCreated)).not.toBe(true);
    expect(poolSnapshot).toMatchObject({ kind: "pool", difficulty: "hard", cueBall: { x: 12, y: 25 } });
    expect(gameSnapshotSchema.safeParse({ ...poolSnapshot, legalMoves: ["pot:1:TM"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...poolSnapshot, balls: [{ id: 1, group: "stripes", x: 32, y: 9 }] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...poolSnapshot, balls: [{ id: 8, group: "eight", x: 76, y: 35 }, { id: 8, group: "eight", x: 10, y: 10 }] }).success).toBe(false);
    const basketballCreated = await client.callTool({ name: "create_game", arguments: { game: "basketball", playerColor: "black", difficulty: "medium" } });
    const basketballSnapshot = basketballCreated.structuredContent as Record<string, unknown>;
    expect(basketballCreated.isError, JSON.stringify(basketballCreated)).not.toBe(true);
    expect(basketballSnapshot).toMatchObject({ kind: "basketball", score: { black: 0, white: 0 }, energy: { black: 4, white: 4 }, legalMoves: ["drive", "pull-up", "three"] });
    expect(gameSnapshotSchema.safeParse({ ...basketballSnapshot, legalMoves: ["dunk"] }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...basketballSnapshot, shotOptions: [{ move: "drive", points: 2, energyCost: 2, accuracy: 101 }] }).success).toBe(false);
    const ajv = new Ajv({ strict: false });
    for (const tool of tools.tools) {
      const validate = ajv.compile(tool.outputSchema as object);
      expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(goSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(ticTacToeSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(connectFourSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(reversiSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(poolSnapshot), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(basketballSnapshot), JSON.stringify(validate.errors)).toBe(true);
      // The published schema is intentionally only the compact common contract;
      // success() below still enforces the complete strict game union.
      expect(validate({ ...ticTacToeSnapshot, legalMoves: ["a1"] }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...snapshot, kind: "secret" }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, internalSecret: "SECRET" }), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...snapshot, difficulty: undefined }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, difficulty: "expert" }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, resetEpoch: -1 }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, resetEpoch: 1.5 }), JSON.stringify(validate.errors)).toBe(false);
      expect(validate({ ...snapshot, stateVersion: -1 }), JSON.stringify(validate.errors)).toBe(false);
      const missingGameId = { ...snapshot };
      delete (missingGameId as { gameId?: unknown }).gameId;
      expect(validate(missingGameId), JSON.stringify(validate.errors)).toBe(false);
    }
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, captures: { ...(goSnapshot.captures as object), secret: "SECRET" } }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, difficulty: undefined }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, difficulty: "expert" }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, resetEpoch: -1 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, resetEpoch: 1.5 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, board: goBoard.slice(1) }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, board: goBoard.map((row, index) => index === 0 ? row.slice(1) : row) }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...goSnapshot, boardSize: 13 }).success).toBe(false);
    expect(gameSnapshotSchema.safeParse({ ...reversiSnapshot, moveHistory: [{ actor: "player", color: "black", notation: "", ply: 1 }] }).success).toBe(false);
    const paddedTicMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: ticTacToeSnapshot.gameId, actor: "player", move: " A1 ", expectedVersion: 0,
    } });
    expect(paddedTicMove.isError).toBe(true);
    expect(JSON.stringify(paddedTicMove)).not.toContain(" A1 ");
    const exactTicMove = await client.callTool({ name: "play_game_move", arguments: {
      gameId: ticTacToeSnapshot.gameId, actor: "player", move: "A1", expectedVersion: 0,
    } });
    expect(exactTicMove.structuredContent).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "A1" }] });
    const invalidBoardSize = await client.callTool({ name: "create_game", arguments: {
      game: "go", playerColor: "black", boardSize: 10,
    } });
    expect(invalidBoardSize.isError).toBe(true);
    expect(JSON.stringify(invalidBoardSize)).not.toContain("10");
    const secretBoardSize = await client.callTool({ name: "create_game", arguments: {
      game: "go", playerColor: "black", boardSize: "SECRET_BOARD_SIZE",
    } });
    expect(secretBoardSize.isError).toBe(true);
    expect(JSON.stringify(secretBoardSize)).not.toContain("SECRET_BOARD_SIZE");
    const secretDifficulty = await client.callTool({ name: "create_game", arguments: {
      game: "chess", playerColor: "white", difficulty: "SECRET_DIFFICULTY",
    } });
    expect(secretDifficulty.isError).toBe(true);
    expect(JSON.stringify(secretDifficulty)).not.toContain("SECRET_DIFFICULTY");
    const render = await client.callTool({ name: "render_game", arguments: { gameId: snapshot.gameId } });
    expect(render.structuredContent).toEqual(snapshot);
    const played = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(played.isError).not.toBe(true);
    expect(played.content).toEqual([{ type: "text", text: `MOVE_CONFIRMED ${JSON.stringify({ gameId: snapshot.gameId, resetEpoch: 0, actor: "player", move: "e2e4", previousVersion: 0, stateVersion: 1 })}` }]);
    const state = await client.callTool({ name: "get_game_state", arguments: { gameId: snapshot.gameId } });
    expect(state.structuredContent).toEqual(played.structuredContent);
    const stale = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "gpt", move: "e7e5", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(stale).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^MOVE_NOT_APPLIED stale_version:/) }] });
    expect(JSON.stringify(stale)).not.toContain("MOVE_CONFIRMED");
    const ended = await client.callTool({ name: "end_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 1, expectedResetEpoch: 0,
    } });
    expect(ended.isError).not.toBe(true);
    expect(ended.structuredContent).toMatchObject({
      gameId: snapshot.gameId,
      status: "finished",
      finishReason: "ended",
      stateVersion: 2,
      legalMoves: [],
      message: "Game ended.",
    });
    expect(ended.content).toEqual([{ type: "text", text: `END_CONFIRMED ${JSON.stringify({
      gameId: snapshot.gameId,
      resetEpoch: 0,
      finishReason: "ended",
      previousVersion: 1,
      stateVersion: 2,
    })}` }]);
    const repeatedEnd = await client.callTool({ name: "end_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 2, expectedResetEpoch: 0,
    } });
    expect(repeatedEnd).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^END_NOT_APPLIED game_finished:/) }] });
    const missing = await client.callTool({ name: "get_game_state", arguments: { gameId: "missing" } });
    expect(missing).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("not_found") }] });
    const staleReset = await client.callTool({ name: "reset_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 1, expectedResetEpoch: 0,
    } });
    expect(staleReset).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^RESET_NOT_APPLIED stale_version:/) }] });
    const reset = await client.callTool({ name: "reset_game", arguments: {
      gameId: snapshot.gameId, confirmed: true, expectedVersion: 2, expectedResetEpoch: 0,
    } });
    expect(reset.structuredContent).toMatchObject({
      gameId: snapshot.gameId,
      difficulty: "medium",
      stateVersion: 0,
      resetEpoch: 1,
      moveHistory: [],
    });
    expect(reset.content).toEqual([{ type: "text", text: `RESET_CONFIRMED ${JSON.stringify({
      gameId: snapshot.gameId,
      previousResetEpoch: 0,
      resetEpoch: 1,
      previousVersion: 2,
      stateVersion: 0,
    })}` }]);
    const omittedEpochAfterReset = await client.callTool({ name: "play_game_move", arguments: {
      gameId: snapshot.gameId, actor: "player", move: "e2e4", expectedVersion: 0,
    } });
    expect(omittedEpochAfterReset).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^MOVE_NOT_APPLIED stale_version:/) }] });
    const stateAfterRejectedResetMove = await client.callTool({ name: "get_game_state", arguments: { gameId: snapshot.gameId } });
    expect(stateAfterRejectedResetMove.structuredContent).toMatchObject({ resetEpoch: 1, stateVersion: 0, moveHistory: [] });
    const invalid = await client.callTool({ name: "get_game_state", arguments: { gameId: "" } });
    expect(invalid.isError).toBe(true);

    const resource = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({ uri: WIDGET_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: "<!doctype html><title>fixture</title>" });
    expect((resource.contents[0] as { _meta?: unknown })._meta).toEqual({
      ui: {
        prefersBorder: true,
        csp: { connectDomains: [], resourceDomains: [] },
        domain: "https://games.example.com",
      },
      "openai/widgetDescription": WIDGET_DESCRIPTION,
    });
    const legacyResource = await client.readResource({ uri: LEGACY_WIDGET_RESOURCE_URIS[0] });
    expect(legacyResource.contents[0]).toMatchObject({
      uri: LEGACY_WIDGET_RESOURCE_URIS[0],
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><title>fixture</title>",
    });

    await Promise.all([client.close(), server.close()]);
  });

  it("never exposes widget loader failures through resource reads", async () => {
    const server = createMcpServer(new ToolService(new GameStore()), {
      loadWidgetHtml: () => { throw new Error("SECRET_LOADER_VALUE"); },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const resource = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    expect(JSON.stringify(resource)).not.toContain("SECRET_LOADER_VALUE");
    expect(resource.contents[0]).toMatchObject({ text: expect.stringContaining("npm run build --workspace web") });
    await Promise.all([client.close(), server.close()]);
  });

  it("returns a safe MCP error for unexpected tool-service failures", async () => {
    const service = new ToolService(new GameStore());
    vi.spyOn(service, "createGame").mockImplementation(() => { throw new Error("SECRET_SERVICE_VALUE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_SERVICE_VALUE");
    await Promise.all([client.close(), server.close()]);
  });

  it("marks unexpected play failures as unconfirmed without leaking details", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "playGameMove").mockImplementation(() => { throw new Error("SECRET_PLAY_FAILURE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "play_game_move", arguments: {
      gameId: created.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "MOVE_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_PLAY_FAILURE");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ stateVersion: 0, moveHistory: [] });
    await Promise.all([client.close(), server.close()]);
  });

  it("marks unexpected imported-position confirmation failures as unknown without leaking details", async () => {
    const service = new ToolService(new GameStore());
    const imported = service.importGoPosition({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["D4"],
      whiteStones: ["E5"],
      captures: { black: 0, white: 0 },
    });
    vi.spyOn(service, "confirmImportedGoPosition").mockImplementation(() => { throw new Error("SECRET_IMPORT_REVIEW_FAILURE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "confirm_imported_go_position", arguments: {
      gameId: imported.gameId, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "IMPORT_REVIEW_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_IMPORT_REVIEW_FAILURE");
    expect(service.getGameState({ gameId: imported.gameId })).toMatchObject({ stateVersion: 0, importReview: "pending" });
    await Promise.all([client.close(), server.close()]);
  });

  it("marks unexpected end failures as unconfirmed without leaking details", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "endGame").mockImplementation(() => { throw new Error("SECRET_END_FAILURE"); });
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "end_game", arguments: {
      gameId: created.gameId, confirmed: true, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "END_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_END_FAILURE");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ status: "active", stateVersion: 0 });
    await Promise.all([client.close(), server.close()]);
  });

  it("uses an unconfirmed marker if output validation fails after a move committed", async () => {
    const service = new ToolService(new GameStore());
    const created = service.createGame({ game: "chess", playerColor: "white" });
    const play = service.playGameMove.bind(service);
    vi.spyOn(service, "playGameMove").mockImplementation(input => ({ ...play(input), internalSecret: "SECRET_POST_COMMIT" } as unknown as ReturnType<ToolService["playGameMove"]>));
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "play_game_move", arguments: {
      gameId: created.gameId, actor: "player", move: "e2e4", expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "MOVE_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_POST_COMMIT");
    expect(service.getGameState({ gameId: created.gameId })).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "e2e4" }] });
    await Promise.all([client.close(), server.close()]);
  });

  it("uses an unknown marker if output validation fails after import confirmation committed", async () => {
    const service = new ToolService(new GameStore());
    const imported = service.importGoPosition({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["D4"],
      whiteStones: ["E5"],
      captures: { black: 0, white: 0 },
    });
    const confirm = service.confirmImportedGoPosition.bind(service);
    vi.spyOn(service, "confirmImportedGoPosition").mockImplementation(input => ({
      ...confirm(input),
      internalSecret: "SECRET_IMPORT_REVIEW_POST_COMMIT",
    } as unknown as ReturnType<ToolService["confirmImportedGoPosition"]>));
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "confirm_imported_go_position", arguments: {
      gameId: imported.gameId, expectedVersion: 0, expectedResetEpoch: 0,
    } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "IMPORT_REVIEW_CONFIRMATION_UNKNOWN internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET_IMPORT_REVIEW_POST_COMMIT");
    expect(service.getGameState({ gameId: imported.gameId })).toMatchObject({ stateVersion: 1, importReview: "confirmed" });
    await Promise.all([client.close(), server.close()]);
  });

  it("rejects unexpected extra fields in service snapshots", async () => {
    const service = new ToolService(new GameStore());
    const valid = service.createGame({ game: "chess", playerColor: "white" });
    vi.spyOn(service, "createGame").mockReturnValue({ ...valid, internalSecret: "SECRET" } as unknown as typeof valid);
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    await Promise.all([client.close(), server.close()]);
  });

  it("rejects unexpected tool arguments before executing the handler", async () => {
    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const server = createMcpServer(service);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const rejected = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white", unexpected: "SECRET" } });
    expect(rejected.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(rejected)).not.toContain("SECRET");
    const valid = await client.callTool({ name: "create_game", arguments: { game: "chess", playerColor: "white" } });
    expect(valid.isError).not.toBe(true);
    expect(JSON.stringify(valid)).not.toContain("unexpected");
    await Promise.all([client.close(), server.close()]);
  });

  it("records safe MCP tool outcomes without request data or error details", async () => {
    const events: OperationalEvent[] = [];
    const timestamps = [0, 7, 10, 15, 20, 29];
    const service = new ToolService(new GameStore());
    const server = createMcpServer(service, {
      telemetry: { record: event => events.push(event) },
      now: () => timestamps.shift() ?? 29,
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const success = await client.callTool({
      name: "create_game",
      arguments: { game: "chess", playerColor: "white" },
    });
    expect(success.isError).not.toBe(true);

    const rejected = await client.callTool({
      name: "get_game_state",
      arguments: { gameId: "SECRET_GAME_ID" },
    });
    expect(rejected.isError).toBe(true);

    vi.spyOn(service, "getGameState").mockImplementation(() => {
      throw new Error("SECRET_SERVICE_FAILURE");
    });
    const failed = await client.callTool({
      name: "get_game_state",
      arguments: { gameId: "SECRET_SECOND_GAME_ID" },
    });
    expect(failed.isError).toBe(true);

    expect(events).toEqual([
      { event: "tool_call", transport: "mcp", tool: "create_game", outcome: "success", durationMs: 7 },
      { event: "tool_call", transport: "mcp", tool: "get_game_state", outcome: "rejected", durationMs: 5 },
      { event: "tool_call", transport: "mcp", tool: "get_game_state", outcome: "error", durationMs: 9 },
    ]);
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(JSON.stringify(events)).not.toContain("gameId");
    await Promise.all([client.close(), server.close()]);
  });
});
