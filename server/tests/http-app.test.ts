import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createHttpApp, FixedWindowLimiter } from "../src/http-app.js";
import { LEGACY_WIDGET_RESOURCE_URIS, WIDGET_RESOURCE_URI } from "../src/mcp-server.js";
import { toolInputSchemas } from "../src/tool-contracts.js";
import { GameStore } from "../src/game-store.js";
import type { OperationalEvent } from "../src/telemetry.js";
import { ToolService } from "../src/tool-service.js";

class ExplodingToolService extends ToolService {
  override createGame(): never {
    throw new Error("SECRET_SERVICE_VALUE");
  }

  override getGameState(): never {
    throw new Error("SECRET_SERVICE_VALUE");
  }
}

class LeakySnapshotToolService extends ToolService {
  override createGame(input: { game: "chess" | "go"; playerColor: "white" | "black" }) {
    return { ...super.createGame(input), internalSecret: "SECRET" };
  }
}

describe("HTTP game arena app", () => {
  it("serves health and a fixture preview", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), {
      loadWidgetHtml: () => "<!doctype html><title>fixture</title>",
    });
    const health = await request(app).get("/health");
    expect(health.body).toEqual({ ok: true });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["referrer-policy"]).toBe("no-referrer");
    expect(health.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ready: true });
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect(ready.headers["x-turnplay-boot-id"]).toBe(health.headers["x-turnplay-boot-id"]);
    const preview = await request(app).get("/preview");
    expect(preview.status).toBe(200);
    expect(preview.text).toContain("fixture");
  });

  it("reuses one non-cacheable boot identity across apps in the same process", async () => {
    const first = createHttpApp(new ToolService(new GameStore()), { loadWidgetHtml: () => "<!doctype html>" });
    const second = createHttpApp(new ToolService(new GameStore()), { loadWidgetHtml: () => "<!doctype html>" });
    const [firstHealth, secondHealth] = await Promise.all([
      request(first).get("/health"),
      request(second).get("/health"),
    ]);
    expect(firstHealth.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(secondHealth.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(secondHealth.headers["x-turnplay-boot-id"]).toBe(firstHealth.headers["x-turnplay-boot-id"]);
  });

  it("reports unready when authoritative storage loses readiness", async () => {
    const service = new ToolService(new GameStore());
    vi.spyOn(service, "checkReadiness").mockResolvedValue(false);
    const app = createHttpApp(service, { loadWidgetHtml: () => "<!doctype html>" });
    const response = await request(app).get("/ready");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ready: false });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("serves the exact OpenAI app domain challenge only when configured", async () => {
    const disabled = createHttpApp(new ToolService(new GameStore()));
    const missing = await request(disabled).get("/.well-known/openai-apps-challenge");
    expect(missing.status).toBe(404);
    expect(missing.text).toBe("Not found.");
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(missing.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);

    const enabled = createHttpApp(new ToolService(new GameStore()), {
      openAiAppsChallengeToken: "challenge_token-123",
    });
    const challenge = await request(enabled).get("/.well-known/openai-apps-challenge");
    expect(challenge.status).toBe(200);
    expect(challenge.type).toBe("text/plain");
    expect(challenge.headers["cache-control"]).toBe("no-store");
    expect(challenge.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(challenge.text).toBe("challenge_token-123");
  });

  it("returns a clear preview build error and dispatches the standalone game flow", async () => {
    const service = new ToolService(new GameStore());
    const app = createHttpApp(service, { loadWidgetHtml: () => undefined });
    const unavailable = await request(app).get("/preview");
    expect(unavailable.status).toBe(503);
    expect(unavailable.text).toContain("npm run build --workspace web");
    expect(unavailable.text).not.toContain("/Users/");
    const notReady = await request(app).get("/ready");
    expect(notReady.status).toBe(503);
    expect(notReady.body).toEqual({ ready: false });

    const created = await request(app).post("/api/tools/create_game").send({ game: "chess", playerColor: "white" });
    expect(created.status).toBe(200);
    expect(created.body.structuredContent.difficulty).toBe("medium");
    const gameId = created.body.structuredContent.gameId as string;
    const played = await request(app).post("/api/tools/play_game_move").send({
      gameId, actor: "player", move: "e2e4", expectedVersion: 0,
    });
    expect(played.status).toBe(200);
    const state = await request(app).post("/api/tools/get_game_state").send({ gameId });
    expect(state.body.structuredContent).toEqual(played.body.structuredContent);
    const unconfirmed = await request(app).post("/api/tools/end_game").send({
      gameId, confirmed: false, expectedVersion: 1, expectedResetEpoch: 0,
    });
    expect(unconfirmed.status).toBe(400);
    const staleEnd = await request(app).post("/api/tools/end_game").send({
      gameId, confirmed: true, expectedVersion: 0, expectedResetEpoch: 0,
    });
    expect(staleEnd.status).toBe(409);
    expect(service.getGameState({ gameId })).toEqual(played.body.structuredContent);
    const ended = await request(app).post("/api/tools/end_game").send({
      gameId, confirmed: true, expectedVersion: 1, expectedResetEpoch: 0,
    });
    expect(ended.status).toBe(200);
    expect(ended.body.content[0].text).toMatch(/^END_CONFIRMED /);
    expect(ended.body.structuredContent).toMatchObject({
      gameId, status: "finished", finishReason: "ended", stateVersion: 2, legalMoves: [], message: "Game ended.",
    });
    const reset = await request(app).post("/api/tools/reset_game").send({
      gameId, confirmed: true, expectedVersion: 2, expectedResetEpoch: 0,
    });
    expect(reset.body.content[0].text).toMatch(/^RESET_CONFIRMED /);
    expect(reset.body.structuredContent).toMatchObject({ gameId, difficulty: "medium", stateVersion: 0, moveHistory: [] });
  });

  it("rejects whitespace-padded moves through REST without recording them", async () => {
    const service = new ToolService(new GameStore());
    const app = createHttpApp(service);
    const created = await request(app).post("/api/tools/create_game").send({ game: "tic-tac-toe", playerColor: "black" });
    const gameId = created.body.structuredContent.gameId as string;
    const padded = await request(app).post("/api/tools/play_game_move").send({ gameId, actor: "player", move: " A1 ", expectedVersion: 0 });
    expect(padded.status).toBe(409);
    expect(JSON.stringify(padded.body)).not.toContain(" A1 ");
    expect((await request(app).post("/api/tools/get_game_state").send({ gameId })).body.structuredContent).toMatchObject({ stateVersion: 0, moveHistory: [] });
    const exact = await request(app).post("/api/tools/play_game_move").send({ gameId, actor: "player", move: "A1", expectedVersion: 0 });
    expect(exact.status).toBe(200);
    expect(exact.body.structuredContent).toMatchObject({ stateVersion: 1, moveHistory: [{ notation: "A1" }] });
  });

  it("accepts supported Go board sizes through REST and rejects invalid sizes", async () => {
    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const app = createHttpApp(service);

    const defaultResponse = await request(app).post("/api/tools/create_game").send({ game: "go", playerColor: "black" });
    expect(defaultResponse.status).toBe(200);
    expect(defaultResponse.body.structuredContent).toMatchObject({ kind: "go", boardSize: 9, difficulty: "medium" });

    for (const [boardSize, expectedMoves] of [[9, 82], [13, 170], [19, 362]] as const) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "go", playerColor: "black", boardSize,
      });
      expect(response.status).toBe(200);
      expect(response.body.structuredContent).toMatchObject({ kind: "go", boardSize });
      expect(response.body.structuredContent.board).toHaveLength(boardSize);
      expect(response.body.structuredContent.legalMoves).toHaveLength(expectedMoves);
    }

    for (const boardSize of [7, 10, 20, "19", null]) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "go", playerColor: "black", boardSize,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });
    }
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("imports a Go position through REST and safely rejects invalid photo transcriptions", async () => {
    const app = createHttpApp(new ToolService(new GameStore()));
    const imported = await request(app).post("/api/tools/import_go_position").send({
      boardSize: 9,
      playerColor: "white",
      turn: "white",
      blackStones: ["D4"],
      whiteStones: ["E4"],
    });
    expect(imported.status).toBe(200);
    expect(imported.body.content[0].text).toMatch(/^IMPORT_CONFIRMED /);
    expect(imported.body.structuredContent).toMatchObject({
      kind: "go",
      boardSize: 9,
      playerColor: "white",
      turn: "white",
      stateVersion: 0,
      importReview: "pending",
      legalMoves: [],
      captures: { black: 0, white: 0 },
      initialPosition: { source: "imported", blackStones: ["D4"], whiteStones: ["E4"] },
    });
    const gameId = imported.body.structuredContent.gameId as string;
    const blockedMove = await request(app).post("/api/tools/play_game_move").send({
      gameId, actor: "player", move: "A1", expectedVersion: 0, expectedResetEpoch: 0,
    });
    expect(blockedMove.status).toBe(409);
    expect(blockedMove.body).toEqual({ error: { code: "import_review_required", message: "The requested game operation could not be completed." } });
    const confirmed = await request(app).post("/api/tools/confirm_imported_go_position").send({
      gameId, expectedVersion: 0, expectedResetEpoch: 0,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.structuredContent).toMatchObject({ gameId, stateVersion: 1, importReview: "confirmed" });
    expect(confirmed.body.content[0].text).toMatch(/^IMPORT_REVIEW_CONFIRMED /);

    const malformed = await request(app).post("/api/tools/import_go_position").send({
      boardSize: 9,
      playerColor: "white",
      turn: "white",
      blackStones: ["D4", "D4"],
      whiteStones: [],
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });

    const unplayable = await request(app).post("/api/tools/import_go_position").send({
      boardSize: 9,
      playerColor: "black",
      turn: "black",
      blackStones: ["A1"],
      whiteStones: ["A2", "B1"],
    });
    expect(unplayable.status).toBe(409);
    expect(unplayable.body).toEqual({ error: { code: "invalid_position", message: "The requested game operation could not be completed." } });
  });

  it("defaults difficulty to medium, accepts every level, and safely rejects invalid levels through REST", async () => {
    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const app = createHttpApp(service);

    const defaultResponse = await request(app).post("/api/tools/create_game").send({ game: "chess", playerColor: "white" });
    expect(defaultResponse.status).toBe(200);
    expect(defaultResponse.body.structuredContent.difficulty).toBe("medium");

    for (const difficulty of ["easy", "medium", "hard"]) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "go", playerColor: "black", difficulty,
      });
      expect(response.status).toBe(200);
      expect(response.body.structuredContent).toMatchObject({ kind: "go", difficulty });
    }

    for (const difficulty of ["Medium", "expert", "", 1, null, "SECRET_DIFFICULTY"]) {
      const response = await request(app).post("/api/tools/create_game").send({
        game: "chess", playerColor: "white", difficulty,
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });
      if (difficulty === "SECRET_DIFFICULTY") expect(response.text).not.toContain(difficulty);
    }
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("maps validation, domain, unknown-tool, rate-limit, and body-size failures safely", async () => {
    let now = 0;
    const app = createHttpApp(new ToolService(new GameStore()), {
      now: () => now,
      apiToolsRateLimit: { limit: 2, windowMs: 1_000, maxBuckets: 2 },
    });
    const invalid = await request(app).post("/api/tools/get_game_state").send({ gameId: "" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toEqual({ code: "invalid_input", message: "Invalid tool input." });
    const missing = await request(app).post("/api/tools/get_game_state").send({ gameId: "missing" });
    expect(missing.status).toBe(409);
    expect(missing.body).toEqual({ error: { code: "not_found", message: "The requested game operation could not be completed." } });
    const unknown = await request(app).post("/api/tools/nope").send({});
    expect(unknown.status).toBe(429);
    expect(unknown.headers["retry-after"]).toBe("1");
    now = 1_000;
    const afterWindow = await request(app).post("/api/tools/nope").send({});
    expect(afterWindow.status).toBe(404);
    const oversized = await request(app)
      .post("/api/tools/get_game_state")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ gameId: "x".repeat(33 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: { code: "payload_too_large", message: "Request body is too large." } });
  });

  it("rejects unexpected fields in every tool input without invoking service methods", async () => {
    const validInputs = {
      create_game: { game: "chess", playerColor: "white" },
      import_go_position: { boardSize: 9, playerColor: "white", turn: "white", blackStones: ["D4"], whiteStones: ["E5"] },
      confirm_imported_go_position: { gameId: "game", expectedVersion: 0, expectedResetEpoch: 0 },
      get_game_state: { gameId: "game" },
      play_game_move: { gameId: "game", actor: "player", move: "e2e4", expectedVersion: 0 },
      end_game: { gameId: "game", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0 },
      reset_game: { gameId: "game", confirmed: true, expectedVersion: 0, expectedResetEpoch: 0 },
      render_game: { gameId: "game" },
    } as const;
    for (const [name, schema] of Object.entries(toolInputSchemas)) {
      expect(schema.safeParse({ ...validInputs[name as keyof typeof validInputs], unexpected: "SECRET" }).success).toBe(false);
    }

    const service = new ToolService(new GameStore());
    const create = vi.spyOn(service, "createGame");
    const app = createHttpApp(service);
    const rest = await request(app).post("/api/tools/create_game").send({ ...validInputs.create_game, unexpected: "SECRET" });
    expect(rest.status).toBe(400);
    expect(rest.body).toEqual({ error: { code: "invalid_input", message: "Invalid tool input." } });
    expect(create).not.toHaveBeenCalled();
  });

  it("serves stateless MCP initialize, list, and tool-call requests", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), { loadWidgetHtml: () => "<!doctype html>" });
    const initialize = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(initialize.status).toBe(200);
    expect(initialize.body.result.serverInfo.name).toBe("gpt-game-arena");
    expect(initialize.headers["cache-control"]).toBe("no-store");
    expect(initialize.headers["x-turnplay-boot-id"]).toMatch(/^[0-9a-f]{32}$/);
    const list = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    expect(list.headers["x-turnplay-boot-id"]).toBe(initialize.headers["x-turnplay-boot-id"]);
    expect(list.body.result.tools).toHaveLength(8);
    const call = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 13, difficulty: "hard" } },
    });
    expect(call.status).toBe(200);
    expect(call.body.result.structuredContent.kind).toBe("go");
    expect(call.body.result.structuredContent.boardSize).toBe(13);
    expect(call.body.result.structuredContent.difficulty).toBe("hard");

    const rejected = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_game", arguments: { game: "go", playerColor: "black", boardSize: 10 } },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.result.isError).toBe(true);
    expect(JSON.stringify(rejected.body.result)).not.toContain("10");

    const rejectedDifficulty = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_game", arguments: { game: "chess", playerColor: "white", difficulty: "SECRET_DIFFICULTY" } },
    });
    expect(rejectedDifficulty.status).toBe(200);
    expect(rejectedDifficulty.body.result.isError).toBe(true);
    expect(JSON.stringify(rejectedDifficulty.body.result)).not.toContain("SECRET_DIFFICULTY");
  });

  it("rate-limits MCP requests with a JSON-RPC-safe response", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1, windowMs: 60_000 } });
    const first = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(first.status).toBe(200);
    const limited = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
  });

  it("honors forwarded client IPs only from explicitly trusted proxy ranges", async () => {
    const untrusted = createHttpApp(new ToolService(new GameStore()), {
      apiToolsRateLimit: { limit: 1, windowMs: 60_000 },
    });
    const direct = await request(untrusted).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.10").send({});
    expect(direct.status).toBe(404);
    expect(direct.headers["x-ratelimit-limit"]).toBe("1");
    expect(direct.headers["x-ratelimit-remaining"]).toBe("0");
    const spoofed = await request(untrusted).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.11").send({});
    expect(spoofed.status).toBe(429);

    const trusted = createHttpApp(new ToolService(new GameStore()), {
      trustedProxyCidrs: ["127.0.0.0/8", "::1/128"],
      apiToolsRateLimit: { limit: 1, windowMs: 60_000 },
    });
    expect((await request(trusted).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.10").send({})).status).toBe(404);
    expect((await request(trusted).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.11").send({})).status).toBe(404);
    const repeated = await request(trusted).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.10").send({});
    expect(repeated.status).toBe(429);
    expect(repeated.headers["x-ratelimit-reset"]).toBeDefined();

    const singleHop = createHttpApp(new ToolService(new GameStore()), {
      trustedProxyHops: 1,
      apiToolsRateLimit: { limit: 1, windowMs: 60_000 },
    });
    expect((await request(singleHop).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.20").send({})).status).toBe(404);
    expect((await request(singleHop).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.21").send({})).status).toBe(404);
    expect((await request(singleHop).post("/api/tools/nope").set("X-Forwarded-For", "203.0.113.20").send({})).status).toBe(429);
  });

  it("uses Render's overwritten CF client-IP header without enabling Express proxy trust", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), {
      rateLimitClientIpSource: "render-cf-connecting-ip",
      apiToolsRateLimit: { limit: 1, windowMs: 60_000 },
    });
    expect(app.enabled("trust proxy")).toBe(false);

    const first = await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "203.0.113.30")
      .set("X-Forwarded-For", "198.51.100.10")
      .send({});
    expect(first.status).toBe(404);
    const differentClient = await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "203.0.113.31")
      .set("X-Forwarded-For", "198.51.100.11")
      .send({});
    expect(differentClient.status).toBe(404);
    const spoofedForwardingChain = await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "203.0.113.30")
      .set("X-Forwarded-For", "192.0.2.1, 192.0.2.2")
      .send({});
    expect(spoofedForwardingChain.status).toBe(429);
  });

  it("rejects ambiguous programmatic Render and Express proxy trust", () => {
    expect(() => createHttpApp(new ToolService(new GameStore()), {
      rateLimitClientIpSource: "render-cf-connecting-ip",
      trustedProxyHops: 1,
    })).toThrow(/must not be combined/);
  });

  it("shares one fail-closed bucket for missing or malformed Render client-IP headers", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), {
      rateLimitClientIpSource: "render-cf-connecting-ip",
      apiToolsRateLimit: { limit: 1, windowMs: 60_000 },
    });
    expect((await request(app).post("/api/tools/nope").send({})).status).toBe(404);
    expect((await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "2".repeat(46))
      .send({})).status).toBe(429);
  });

  it("enforces a process-wide rate-limit backstop across distinct client buckets", async () => {
    const app = createHttpApp(new ToolService(new GameStore()), {
      rateLimitClientIpSource: "render-cf-connecting-ip",
      apiToolsRateLimit: { limit: 10, windowMs: 60_000 },
      apiToolsGlobalRateLimit: { limit: 1, windowMs: 60_000 },
    });
    expect((await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "203.0.113.50")
      .send({})).status).toBe(404);
    const limited = await request(app)
      .post("/api/tools/nope")
      .set("CF-Connecting-IP", "203.0.113.51")
      .send({});
    expect(limited.status).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("1");
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("uses protocol-specific safe parse and size error envelopes", async () => {
    const app = createHttpApp(new ToolService(new GameStore()));
    const restMalformed = await request(app).post("/api/tools/get_game_state").set("Content-Type", "application/json").send("{");
    expect(restMalformed.status).toBe(400);
    expect(restMalformed.body).toEqual({ error: { code: "invalid_json", message: "Invalid JSON request body." } });
    const mcpMalformed = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send("{");
    expect(mcpMalformed.status).toBe(400);
    expect(mcpMalformed.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
    const mcpOversized = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(mcpOversized.status).toBe(413);
    expect(mcpOversized.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  });

  it("counts malformed and oversized requests before parsing their bodies", async () => {
    const rest = createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 1 } });
    expect((await request(rest).post("/api/tools/get_game_state").set("Content-Type", "application/json").send("{")).status).toBe(400);
    const restLimited = await request(rest).post("/api/tools/get_game_state").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(restLimited.status).toBe(429);

    const mcp = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1 } });
    expect((await request(mcp).post("/mcp").set("Content-Type", "application/json").send("{")).status).toBe(400);
    const mcpLimited = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(JSON.stringify({ payload: "x".repeat(33 * 1024) }));
    expect(mcpLimited.status).toBe(429);
    expect(mcpLimited.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
  });

  it("treats unsupported media as safe client errors that consume quota", async () => {
    const media = createHttpApp(new ToolService(new GameStore()));
    const restEncoding = await request(media).post("/api/tools/create_game").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(restEncoding.status).toBe(415);
    expect(restEncoding.body).toEqual({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
    const mcpCharset = await request(media).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(mcpCharset.status).toBe(415);
    expect(mcpCharset.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32015, message: "Unsupported JSON media type." } });

    const rest = createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 1 } });
    const restCharset = await request(rest).post("/api/tools/create_game").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(restCharset.status).toBe(415);
    expect(restCharset.body).toEqual({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
    const restLimited = await request(rest).post("/api/tools/create_game").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(restLimited.status).toBe(429);

    const mcp = createHttpApp(new ToolService(new GameStore()), { mcpRateLimit: { limit: 1 } });
    const mcpEncoding = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").set("Content-Encoding", "x-secret").send("{}");
    expect(mcpEncoding.status).toBe(415);
    expect(mcpEncoding.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32015, message: "Unsupported JSON media type." } });
    expect(mcpEncoding.text).not.toContain("x-secret");
    const mcpLimited = await request(mcp).post("/mcp").set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json; charset=x-secret").send("{}");
    expect(mcpLimited.status).toBe(429);
  });

  it("keeps generic REST failures and MCP resource loader errors secret-safe", async () => {
    const failingApp = createHttpApp(new ExplodingToolService(new GameStore()));
    const generic = await request(failingApp).post("/api/tools/get_game_state").send({ gameId: "game" });
    expect(generic.status).toBe(500);
    expect(generic.body).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
    expect(generic.text).not.toContain("SECRET_SERVICE_VALUE");

    const app = createHttpApp(new ExplodingToolService(new GameStore()), {
      loadWidgetHtml: () => { throw new Error("SECRET_LOADER_VALUE"); },
    });
    const resource = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: WIDGET_RESOURCE_URI },
    });
    expect(resource.status).toBe(200);
    expect(resource.text).not.toContain("SECRET_LOADER_VALUE");
    expect(resource.body.result.contents[0].text).toContain("npm run build --workspace web");

    const legacyResource = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: LEGACY_WIDGET_RESOURCE_URIS[0] },
    });
    expect(legacyResource.status).toBe(200);
    expect(legacyResource.text).not.toContain("SECRET_LOADER_VALUE");
    expect(legacyResource.body.result.contents[0]).toMatchObject({
      uri: LEGACY_WIDGET_RESOURCE_URIS[0],
      text: expect.stringContaining("npm run build --workspace web"),
    });

    const mcpTool = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_game", arguments: { game: "chess", playerColor: "white" } },
    });
    expect(mcpTool.status).toBe(200);
    expect(mcpTool.body.result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(mcpTool.text).not.toContain("SECRET_SERVICE_VALUE");
  });

  it("records allowlisted HTTP surfaces, MCP operations, and REST tool outcomes only", async () => {
    const events: OperationalEvent[] = [];
    let now = 0;
    const service = new ToolService(new GameStore());
    const app = createHttpApp(service, {
      loadWidgetHtml: () => "<!doctype html>",
      telemetry: { record: event => events.push(event) },
      now: () => now++,
    });

    expect((await request(app).get("/health?token=SECRET_QUERY")).status).toBe(200);
    expect((await request(app).post("/api/tools/create_game").send({
      game: "chess", playerColor: "white",
    })).status).toBe(200);
    expect((await request(app).post("/api/tools/get_game_state").send({
      gameId: "SECRET_GAME_ID",
    })).status).toBe(409);
    vi.spyOn(service, "getGameState").mockImplementation(() => {
      throw new Error("SECRET_SERVICE_FAILURE");
    });
    expect((await request(app).post("/api/tools/get_game_state").send({
      gameId: "SECRET_SECOND_GAME_ID",
    })).status).toBe(500);
    expect((await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "SECRET_CLIENT_NAME", version: "1" },
      },
    })).status).toBe(200);

    expect(events.filter(event => event.event === "tool_call")).toEqual([
      expect.objectContaining({ event: "tool_call", transport: "rest", tool: "create_game", outcome: "success" }),
      expect.objectContaining({ event: "tool_call", transport: "rest", tool: "get_game_state", outcome: "rejected" }),
      expect.objectContaining({ event: "tool_call", transport: "rest", tool: "get_game_state", outcome: "error" }),
    ]);
    expect(events.filter(event => event.event === "http_request")).toEqual([
      expect.objectContaining({ event: "http_request", surface: "health", method: "GET", status: 200 }),
      expect.objectContaining({ event: "http_request", surface: "rest-tools", method: "POST", status: 200 }),
      expect.objectContaining({ event: "http_request", surface: "rest-tools", method: "POST", status: 409 }),
      expect.objectContaining({ event: "http_request", surface: "rest-tools", method: "POST", status: 500 }),
      expect.objectContaining({ event: "http_request", surface: "mcp", method: "POST", status: 200, mcpOperation: "initialize" }),
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("gameId");
    expect(serialized).not.toContain("token");
  });

  it("bounds limiter buckets and releases expired capacity", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxBuckets: 2 }, () => now);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.bucketCount()).toBe(2);
    expect(limiter.consume("c").allowed).toBe(false);
    now = 1_000;
    expect(limiter.consume("c").allowed).toBe(true);
    expect(limiter.bucketCount()).toBe(1);
  });

  it("rejects invalid limiter settings and clocks without mutating buckets", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new FixedWindowLimiter({ limit: value }, () => 0)).toThrow(RangeError);
      expect(() => new FixedWindowLimiter({ windowMs: value }, () => 0)).toThrow(RangeError);
      expect(() => new FixedWindowLimiter({ maxBuckets: value }, () => 0)).toThrow(RangeError);
    }
    let now = Number.NaN;
    const limiter = new FixedWindowLimiter({}, () => now);
    expect(() => limiter.consume("ip")).toThrow(RangeError);
    expect(limiter.bucketCount()).toBe(0);
    now = 0;
    expect(limiter.consume("ip").allowed).toBe(true);
    for (const invalidNow of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      now = invalidNow;
      expect(() => limiter.consume("another")).toThrow(RangeError);
      expect(limiter.bucketCount()).toBe(1);
    }
    expect(() => createHttpApp(new ToolService(new GameStore()), { apiToolsRateLimit: { limit: 0 } })).toThrow(RangeError);
  });

  it("turns unexpected service output into safe REST and MCP failures", async () => {
    const app = createHttpApp(new LeakySnapshotToolService(new GameStore()));
    const rest = await request(app).post("/api/tools/create_game").send({ game: "chess", playerColor: "white" });
    expect(rest.status).toBe(500);
    expect(rest.body).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
    expect(rest.text).not.toContain("SECRET");
    const mcp = await request(app).post("/mcp").set("Accept", "application/json, text/event-stream").send({
      jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_game", arguments: { game: "chess", playerColor: "white" } },
    });
    expect(mcp.body.result).toEqual({ isError: true, content: [{ type: "text", text: "internal_error: Internal server error." }] });
    expect(JSON.stringify(mcp.body.result)).not.toContain("SECRET");
  });
});
