import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CURRENT_WIDGET_RESOURCE_URI,
  CURRENT_WIDGET_RELEASE_MARKER,
  normalizeProductionOrigin,
  parseProductionAcceptanceArgs,
  productionSnapshotDigest,
  ProductionAcceptanceError,
  readChallengeTokenFile,
  runProductionAcceptance,
  validateConfirmationReceipt,
  validateProductionReceipt,
  validateWidgetResource,
} from "../../scripts/production-acceptance.mjs";
import { createHttpApp, type HttpAppOptions } from "../src/http-app.js";
import { GameStore } from "../src/game-store.js";
import { ToolService } from "../src/tool-service.js";

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(childProcesses.splice(0).map(stopChildServer));
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "turnplay-production-acceptance-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function listen(app: ReturnType<typeof createHttpApp>, port = 0): Promise<{ server: Server; origin: string; port: number }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(port, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  return { server, origin: `http://127.0.0.1:${address.port}`, port: address.port };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function appForStore(persistencePath: string, options: HttpAppOptions) {
  return createHttpApp(new ToolService(new GameStore({ persistencePath })), options);
}

function widgetDigest(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

async function startChildServer(storePath: string, widgetPath: string, challengeToken: string, port = 0): Promise<{ child: ChildProcess; origin: string; port: number }> {
  const child = fork(resolve(process.cwd(), "tests", "fixtures", "production-acceptance-server.ts"), [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TURNPLAY_TEST_STORE_PATH: storePath,
      TURNPLAY_TEST_WIDGET_PATH: widgetPath,
      TURNPLAY_TEST_CHALLENGE_TOKEN: challengeToken,
      TURNPLAY_TEST_PORT: String(port),
    },
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  childProcesses.push(child);
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2_000); });
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture server did not start. ${stderr}`)), 10_000);
    const failed = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`Fixture server exited before readiness (${code ?? "signal"}). ${stderr}`));
    };
    child.once("exit", failed);
    child.on("message", message => {
      const ready = message as { type?: unknown; origin?: unknown; port?: unknown };
      if (ready.type !== "ready" || typeof ready.origin !== "string" || !Number.isInteger(ready.port)) return;
      clearTimeout(timer);
      child.off("exit", failed);
      resolveReady({ child, origin: ready.origin, port: ready.port as number });
    });
  });
}

async function stopChildServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.send?.({ type: "close" });
  await new Promise<void>(resolveStopped => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStopped();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStopped();
    });
  });
}

describe("production acceptance harness", () => {
  it("proves the exact MCP state and widget survive a real server/store restart", async () => {
    const directory = await temporaryDirectory();
    const storePath = join(directory, "games.json");
    const receiptPath = join(directory, "receipt.json");
    const widgetPath = join(directory, "widget.html");
    const challengeTokenPath = join(directory, "openai-domain-token");
    const challengeToken = "opaque-test-challenge";
    await writeFile(challengeTokenPath, `${challengeToken}\n`, { mode: 0o600 });
    expect((await stat(challengeTokenPath)).mode & 0o777).toBe(0o600);
    const widget = `<!doctype html><meta name="turnplay-widget-release" content="${CURRENT_WIDGET_RELEASE_MARKER}"><title>Turnplay Arena</title><style>.board{width:22rem}</style><script>const pointer={formatVersion:2};</script>${"x".repeat(12_000)}`;
    await writeFile(widgetPath, widget, { mode: 0o600 });
    const first = await startChildServer(storePath, widgetPath, challengeToken);

    const seeded = await runProductionAcceptance({
      phase: "seed",
      baseUrl: first.origin,
      stateFile: receiptPath,
      challengeTokenFile: challengeTokenPath,
      localExpectedWidgetDigest: widgetDigest(widget),
      requireChallenge: true,
      allowHttpLocalhost: true,
    });
    expect(seeded).toMatchObject({
      phase: "seed",
      production: false,
      origin: first.origin,
      widgetResourceUri: CURRENT_WIDGET_RESOURCE_URI,
      resetEpoch: 0,
      stateVersion: 2,
      challengePresent: true,
      challengeExact: true,
      restartProven: false,
    });
    expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { gameId: string; snapshotDigest: string };
    expect(receipt.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);
    await expect(runProductionAcceptance({
      phase: "resume",
      baseUrl: first.origin,
      stateFile: receiptPath,
      challengeTokenFile: challengeTokenPath,
      localExpectedWidgetDigest: widgetDigest(widget),
      requireChallenge: true,
      allowHttpLocalhost: true,
    })).rejects.toThrow("actual restart was not proven");
    await stopChildServer(first.child);

    const second = await startChildServer(storePath, widgetPath, challengeToken, first.port);
    const resumed = await runProductionAcceptance({
      phase: "resume",
      baseUrl: second.origin,
      stateFile: receiptPath,
      challengeTokenFile: challengeTokenPath,
      localExpectedWidgetDigest: widgetDigest(widget),
      requireChallenge: true,
      allowHttpLocalhost: true,
    });
    expect(resumed).toMatchObject({
      phase: "resume",
      production: false,
      origin: first.origin,
      resetEpoch: 0,
      stateVersion: 2,
      challengePresent: true,
      challengeExact: true,
      snapshotDigest: receipt.snapshotDigest,
      restartProven: true,
    });
    await stopChildServer(second.child);
  }, 15_000);

  it("fails closed for unsafe origins and malformed CLI arguments", () => {
    const productionOrigin = "https://turnplay-arena.onrender.com";
    expect(normalizeProductionOrigin(`${productionOrigin}/`)).toBe(productionOrigin);
    for (const value of [
      "http://turnplay-arena.onrender.com",
      "https://user:pass@turnplay-arena.onrender.com",
      "https://turnplay-arena.onrender.com/mcp",
      "https://turnplay-arena.onrender.com?token=secret",
      "not-a-url",
    ]) {
      expect(() => normalizeProductionOrigin(value)).toThrow(ProductionAcceptanceError);
    }
    for (const value of ["https://example.com", "https://games.example.com", "https://203.0.113.1", "https://[::1]", "https://[2001:db8::1]", "https://[::ffff:127.0.0.1]"]) {
      expect(() => normalizeProductionOrigin(value)).toThrow("public production hostname");
    }
    for (const value of ["https://turnplay.trycloudflare.com", "https://turnplay.ngrok-free.app"]) {
      expect(() => normalizeProductionOrigin(value)).toThrow("temporary tunnel hostname");
    }
    expect(normalizeProductionOrigin("http://127.0.0.1:18080", { allowHttpLocalhost: true })).toBe("http://127.0.0.1:18080");
    expect(() => parseProductionAcceptanceArgs(["--phase", "seed"])).toThrow("--base-url is required");
    expect(() => parseProductionAcceptanceArgs(["--phase", "deploy", "--base-url", productionOrigin])).toThrow("--phase must be seed or resume");
    expect(() => parseProductionAcceptanceArgs(["--unknown"])).toThrow("Unknown argument");
  });

  it("requires an exact private portal token file before any HTTPS production request", async () => {
    const directory = await temporaryDirectory();
    let requests = 0;
    await expect(runProductionAcceptance({
      phase: "seed",
      baseUrl: "https://turnplay-arena.onrender.com",
      stateFile: join(directory, "receipt.json"),
      fetchImpl: async () => {
        requests += 1;
        throw new Error("network should not be reached");
      },
    })).rejects.toThrow("requires --challenge-token-file");
    expect(requests).toBe(0);
  });

  it("rejects MCP traffic served by a different process identity", async () => {
    const directory = await temporaryDirectory();
    const storePath = join(directory, "games.json");
    const receiptPath = join(directory, "receipt.json");
    const challengeTokenPath = join(directory, "openai-domain-token");
    const challengeToken = "opaque-test-challenge";
    await writeFile(challengeTokenPath, challengeToken, { mode: 0o600 });
    const widget = `<!doctype html><meta name="turnplay-widget-release" content="${CURRENT_WIDGET_RELEASE_MARKER}"><title>Turnplay Arena</title><style>.board{width:22rem}</style><script>const pointer={formatVersion:2};</script>${"x".repeat(12_000)}`;
    const options: HttpAppOptions = { loadWidgetHtml: () => widget, openAiAppsChallengeToken: challengeToken };
    const running = await listen(appForStore(storePath, options));
    options.widgetDomain = running.origin;
    const splitBootFetch = (async (input: unknown, init?: RequestInit) => {
      const inputUrl = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url: string }).url;
      const response = await fetch(inputUrl, init);
      if (new URL(inputUrl).pathname !== "/mcp") return response;
      const headers = new Headers(response.headers);
      headers.set("x-turnplay-boot-id", "f".repeat(32));
      return new Response(await response.arrayBuffer(), { status: response.status, headers });
    }) as typeof fetch;
    await expect(runProductionAcceptance({
      phase: "seed",
      baseUrl: running.origin,
      stateFile: receiptPath,
      challengeTokenFile: challengeTokenPath,
      localExpectedWidgetDigest: widgetDigest(widget),
      allowHttpLocalhost: true,
      fetchImpl: splitBootFetch,
    })).rejects.toThrow("different provider process");
    await close(running.server);
  });

  it("rejects oversized response bodies before parsing them", async () => {
    const directory = await temporaryDirectory();
    await expect(runProductionAcceptance({
      phase: "seed",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: join(directory, "receipt.json"),
      allowHttpLocalhost: true,
      fetchImpl: async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1) },
      }),
    })).rejects.toThrow("response limit");
  });

  it("rejects stale, extra, and malformed private receipts", () => {
    const playerMove = { actor: "player", color: "black", notation: "A3", ply: 1 };
    const gptMove = { actor: "gpt", color: "white", notation: "B2", ply: 2 };
    const expectedSnapshot = {
      gameId: "game",
      kind: "tic-tac-toe",
      difficulty: "hard",
      playerColor: "black",
      turn: "black",
      status: "active",
      stateVersion: 2,
      resetEpoch: 0,
      board: [
        ["black", null, null],
        [null, "white", null],
        [null, null, null],
      ],
      legalMoves: ["A1", "A2", "B1", "B3", "C1", "C2", "C3"],
      moveHistory: [playerMove, gptMove],
      lastMove: gptMove,
      message: "Black to move.",
    };
    const valid = {
      formatVersion: 1,
      origin: "https://turnplay-arena.onrender.com",
      widgetResourceUri: CURRENT_WIDGET_RESOURCE_URI,
      createdAt: "2026-08-07T00:00:00.000Z",
      challengeRequired: true,
      challengeTokenDigest: "c".repeat(64),
      seedBootId: "b".repeat(32),
      gameId: "game",
      expectedSnapshot,
      snapshotDigest: productionSnapshotDigest(expectedSnapshot),
    };
    expect(validateProductionReceipt(valid)).toEqual(valid);
    expect(() => validateProductionReceipt({ ...valid, extra: true })).toThrow("unexpected shape");
    expect(() => validateProductionReceipt({ ...valid, widgetResourceUri: "ui://gpt-game-arena/v20/widget.html" })).toThrow("stale widget");
    expect(() => validateProductionReceipt({ ...valid, snapshotDigest: "not-a-digest" })).toThrow("invalid state digest");
    const wrongBoard = { ...expectedSnapshot, board: [[null, null, null], [null, "white", null], [null, null, null]] };
    expect(() => validateProductionReceipt({ ...valid, expectedSnapshot: wrongBoard, snapshotDigest: productionSnapshotDigest(wrongBoard) })).toThrow("exact reviewed snapshot");
  });

  it("strictly validates structured mutation confirmation receipts", () => {
    const prefix = "MOVE_CONFIRMED ";
    const expected = {
      gameId: "game",
      resetEpoch: 0,
      actor: "player",
      move: "A3",
      previousVersion: 0,
      stateVersion: 1,
    };
    expect(validateConfirmationReceipt(`${prefix}${JSON.stringify(expected)}`, prefix, expected)).toEqual(expected);
    expect(() => validateConfirmationReceipt(`${prefix}{`, prefix, expected)).toThrow("malformed JSON");
    expect(() => validateConfirmationReceipt(`${prefix}${JSON.stringify({ ...expected, stateVersion: 2 })}`, prefix, expected)).toThrow("does not match the requested mutation");
    expect(() => validateConfirmationReceipt(`${prefix}${JSON.stringify({ ...expected, unexpected: true })}`, prefix, expected)).toThrow("unexpected shape");
    expect(() => validateConfirmationReceipt(`WRONG ${JSON.stringify(expected)}`, prefix, expected)).toThrow("expected confirmation receipt prefix");
  });

  it("rejects stale, loosely typed, or incorrectly bound widget resources", () => {
    const origin = "https://turnplay-arena.onrender.com";
    const content = {
      uri: CURRENT_WIDGET_RESOURCE_URI,
      mimeType: "text/html;profile=mcp-app",
      text: `<!doctype html><meta name="turnplay-widget-release" content="${CURRENT_WIDGET_RELEASE_MARKER}"><title>Turnplay Arena</title><style>.board{width:22rem}</style><script>const pointer={formatVersion:2};</script>${"x".repeat(12_000)}`,
      _meta: {
        ui: {
          domain: origin,
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: [] },
        },
      },
    };
    const digest = widgetDigest(content.text);
    expect(validateWidgetResource({ contents: [content] }, origin, digest)).toBe(content);
    expect(() => validateWidgetResource({ contents: [{ ...content, uri: "ui://gpt-game-arena/v20/widget.html" }] }, origin, digest)).toThrow("mismatched URI");
    expect(() => validateWidgetResource({ contents: [{ ...content, mimeType: "text/html" }] }, origin, digest)).toThrow("wrong MIME type");
    expect(() => validateWidgetResource({ contents: [{ ...content, _meta: { ui: { ...content._meta.ui, domain: "https://other.onrender.com" } } }] }, origin, digest)).toThrow("exact production origin");
    expect(() => validateWidgetResource({ contents: [{ ...content, text: content.text.replace(CURRENT_WIDGET_RELEASE_MARKER, "turnplay-v20-stale") }] }, origin, digest)).toThrow(CURRENT_WIDGET_RELEASE_MARKER);
    expect(() => validateWidgetResource({ contents: [{ ...content, text: `${content.text} ` }] }, origin, digest)).toThrow("reviewed v22 bundle digest");
  });

  it("requires challenge token files to be private and contain exactly one line", async () => {
    const directory = await temporaryDirectory();
    const tokenPath = join(directory, "openai-domain-token");
    await writeFile(tokenPath, "portal-token\n", { mode: 0o600 });
    expect(await readChallengeTokenFile(tokenPath)).toBe("portal-token");

    await chmod(tokenPath, 0o644);
    await expect(readChallengeTokenFile(tokenPath)).rejects.toThrow("use mode 0600");
    await chmod(tokenPath, 0o600);
    await writeFile(tokenPath, "");
    await expect(readChallengeTokenFile(tokenPath)).rejects.toThrow("invalid or oversized");
    for (const contents of ["first\nsecond\n", "carriage-return\r\n"]) {
      await writeFile(tokenPath, contents);
      await expect(readChallengeTokenFile(tokenPath)).rejects.toThrow("exactly one non-empty line");
    }
    await writeFile(tokenPath, "x".repeat(2_050));
    await expect(readChallengeTokenFile(tokenPath)).rejects.toThrow("invalid or oversized");
    const linkPath = join(directory, "linked-token");
    await symlink(tokenPath, linkPath);
    await expect(readChallengeTokenFile(linkPath)).rejects.toThrow("not a symbolic link");
  });

  it("atomically reserves a seed receipt before making any network request", async () => {
    const directory = await temporaryDirectory();
    const receiptPath = join(directory, "receipt.json");
    let releaseFirst!: () => void;
    let reportStarted!: () => void;
    const release = new Promise<void>(resolveRelease => { releaseFirst = resolveRelease; });
    const started = new Promise<void>(resolveStarted => { reportStarted = resolveStarted; });
    let firstRequests = 0;
    const firstRun = runProductionAcceptance({
      phase: "seed",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: receiptPath,
      allowHttpLocalhost: true,
      fetchImpl: async () => {
        firstRequests += 1;
        reportStarted();
        await release;
        throw new Error("intentional first-run stop");
      },
    });
    const firstFailure = firstRun.catch(error => error as Error);
    await started;

    let secondRequests = 0;
    await expect(runProductionAcceptance({
      phase: "seed",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: receiptPath,
      allowHttpLocalhost: true,
      fetchImpl: async () => {
        secondRequests += 1;
        throw new Error("second run must not reach the network");
      },
    })).rejects.toThrow("receipt already exists");
    releaseFirst();
    const firstError = await firstFailure;
    expect(firstError).toBeInstanceOf(ProductionAcceptanceError);
    expect((firstError as Error).message).toContain("could not complete");
    expect(firstRequests).toBe(1);
    expect(secondRequests).toBe(0);
  });

  it("rejects a non-private receipt before making any network request", async () => {
    const directory = await temporaryDirectory();
    const receiptPath = join(directory, "receipt.json");
    await writeFile(receiptPath, "{}\n", { mode: 0o644 });
    await chmod(receiptPath, 0o644);
    let requests = 0;
    await expect(runProductionAcceptance({
      phase: "resume",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: receiptPath,
      allowHttpLocalhost: true,
      fetchImpl: async () => {
        requests += 1;
        throw new Error("network should not be reached");
      },
    })).rejects.toThrow("use mode 0600");
    expect(requests).toBe(0);
  });

  it("rejects an oversized private receipt before making any network request", async () => {
    const directory = await temporaryDirectory();
    const receiptPath = join(directory, "receipt.json");
    await writeFile(receiptPath, "x".repeat(256 * 1024 + 1), { mode: 0o600 });
    let requests = 0;
    await expect(runProductionAcceptance({
      phase: "resume",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: receiptPath,
      allowHttpLocalhost: true,
      fetchImpl: async () => {
        requests += 1;
        throw new Error("network should not be reached");
      },
    })).rejects.toThrow("invalid or oversized");
    expect(requests).toBe(0);
  });

  it("refuses to overwrite a pending seed receipt before making any network request", async () => {
    const directory = await temporaryDirectory();
    const receiptPath = join(directory, "receipt.json");
    await writeFile(receiptPath, "pending\n", { mode: 0o600 });
    let requests = 0;
    await expect(runProductionAcceptance({
      phase: "seed",
      baseUrl: "http://127.0.0.1:18080",
      stateFile: receiptPath,
      allowHttpLocalhost: true,
      fetchImpl: async () => {
        requests += 1;
        throw new Error("network should not be reached");
      },
    })).rejects.toThrow("receipt already exists");
    expect(requests).toBe(0);
  });
});
