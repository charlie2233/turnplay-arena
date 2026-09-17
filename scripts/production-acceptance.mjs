import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  mkdir,
  open,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isIP } from "node:net";

export const PRODUCTION_ACCEPTANCE_FORMAT_VERSION = 1;
export const CURRENT_WIDGET_RESOURCE_URI = "ui://gpt-game-arena/v22/widget.html";
export const CURRENT_WIDGET_RELEASE_MARKER = "turnplay-v22-20260916-opponent";
export const CURRENT_WIDGET_BUNDLE_SHA256 = "0990fe5182bce70c3159ff8bb92d4e7e84f2771c078b63776d4bfa902989dee6";
export const EXPECTED_TOOL_NAMES = [
  "confirm_imported_go_position",
  "create_game",
  "end_game",
  "get_game_state",
  "import_go_position",
  "play_game_move",
  "render_game",
  "reset_game",
];

const expectedAnnotations = {
  confirm_imported_go_position: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  create_game: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  end_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
  get_game_state: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  import_go_position: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  play_game_move: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
  render_game: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  reset_game: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
};

const expectedHistory = [
  { actor: "player", color: "black", notation: "A3", ply: 1 },
  { actor: "gpt", color: "white", notation: "B2", ply: 2 },
];

const openingLegalMoves = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
const afterPlayerLegalMoves = ["A1", "A2", "B1", "B2", "B3", "C1", "C2", "C3"];
const finalLegalMoves = ["A1", "A2", "B1", "B3", "C1", "C2", "C3"];

function expectedOpeningSnapshot(gameId) {
  return {
    gameId,
    kind: "tic-tac-toe",
    difficulty: "hard",
    playerColor: "black",
    turn: "black",
    status: "active",
    legalMoves: openingLegalMoves,
    moveHistory: [],
    stateVersion: 0,
    resetEpoch: 0,
    message: "Black to move.",
    board: [[null, null, null], [null, null, null], [null, null, null]],
  };
}

function expectedPlayerSnapshot(gameId) {
  return {
    gameId,
    kind: "tic-tac-toe",
    difficulty: "hard",
    playerColor: "black",
    turn: "white",
    status: "active",
    legalMoves: afterPlayerLegalMoves,
    moveHistory: [expectedHistory[0]],
    lastMove: expectedHistory[0],
    stateVersion: 1,
    resetEpoch: 0,
    message: "White to move.",
    board: [["black", null, null], [null, null, null], [null, null, null]],
  };
}

function expectedFinalSnapshot(gameId) {
  return {
    gameId,
    kind: "tic-tac-toe",
    difficulty: "hard",
    playerColor: "black",
    turn: "black",
    status: "active",
    legalMoves: finalLegalMoves,
    moveHistory: expectedHistory,
    lastMove: expectedHistory[1],
    stateVersion: 2,
    resetEpoch: 0,
    message: "Black to move.",
    board: [["black", null, null], [null, "white", null], [null, null, null]],
  };
}

export class ProductionAcceptanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionAcceptanceError";
  }
}

function fail(message) {
  throw new ProductionAcceptanceError(message);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function exactKeys(value, keys, label) {
  assert(isPlainObject(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} has an unexpected shape.`);
}

export function normalizeProductionOrigin(value, { allowHttpLocalhost = false } = {}) {
  assert(typeof value === "string" && value.length > 0, "--base-url is required.");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--base-url must be a valid absolute URL.");
  }
  assert(url.username === "" && url.password === "", "--base-url must not contain credentials.");
  assert(url.search === "" && url.hash === "", "--base-url must not contain a query or fragment.");
  assert(url.pathname === "/" || url.pathname === "", "--base-url must be an origin without a path.");
  const localHttp = allowHttpLocalhost
    && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  assert(url.protocol === "https:" || localHttp, "--base-url must use HTTPS.");
  if (!localHttp) {
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const ipCandidate = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    const temporarySuffixes = [
      ".trycloudflare.com",
      ".ngrok-free.app",
      ".ngrok.app",
      ".ngrok.io",
      ".loca.lt",
      ".localhost.run",
      ".serveo.net",
      ".tunnelmole.net",
    ];
    const reserved = hostname === "localhost"
      || hostname === "example.com"
      || hostname.endsWith(".example.com")
      || hostname.endsWith(".example")
      || hostname.endsWith(".invalid")
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".test");
    assert(!reserved && isIP(ipCandidate) === 0, "--base-url must use a public production hostname.");
    assert(!temporarySuffixes.some(suffix => hostname.endsWith(suffix)), "--base-url must not use a temporary tunnel hostname.");
  }
  return url.origin;
}

export function parseProductionAcceptanceArgs(argv, cwd = process.cwd()) {
  const options = {
    phase: undefined,
    baseUrl: undefined,
    stateFile: resolve(cwd, ".data", "production-acceptance-v22.json"),
    challengeTokenFile: undefined,
    requireChallenge: false,
    allowHttpLocalhost: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--require-challenge") {
      options.requireChallenge = true;
      continue;
    }
    if (argument === "--allow-http-localhost") {
      options.allowHttpLocalhost = true;
      continue;
    }
    if (["--phase", "--base-url", "--state-file", "--challenge-token-file"].includes(argument)) {
      const next = argv[index + 1];
      assert(typeof next === "string" && next.length > 0 && !next.startsWith("--"), `${argument} requires a value.`);
      index += 1;
      if (argument === "--phase") options.phase = next;
      else if (argument === "--base-url") options.baseUrl = next;
      else if (argument === "--state-file") options.stateFile = resolve(cwd, next);
      else options.challengeTokenFile = resolve(cwd, next);
      continue;
    }
    fail(`Unknown argument: ${argument}`);
  }

  if (!options.help) {
    assert(options.phase === "seed" || options.phase === "resume", "--phase must be seed or resume.");
    assert(typeof options.baseUrl === "string", "--base-url is required.");
  }
  return options;
}

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CHALLENGE_BODY_BYTES = 2_048;
const MAX_PRIVATE_RECEIPT_BYTES = 256 * 1024;

async function readPrivateFile(path, label, maximumBytes) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} was not found.`);
    fail(`${label} must be a readable regular file, not a symbolic link.`);
  }
  try {
    const metadata = await handle.stat();
    assert(metadata.isFile(), `${label} must be a regular file.`);
    assert((metadata.mode & 0o077) === 0, `${label} must not be readable or writable by group or others (use mode 0600).`);
    assert(metadata.size > 0 && metadata.size <= maximumBytes, `${label} has an invalid or oversized file length.`);
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assert(length > 0 && length <= maximumBytes, `${label} has an invalid or oversized file length.`);
    return buffer.subarray(0, length).toString("utf8");
  } catch (error) {
    if (error instanceof ProductionAcceptanceError) throw error;
    fail(`${label} could not be read safely.`);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function readChallengeTokenFile(path) {
  assert(typeof path === "string" && path.length > 0, "Challenge token file path is required.");
  const raw = await readPrivateFile(path, "Challenge token file", MAX_CHALLENGE_BODY_BYTES + 1);
  const token = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  assert(token.length > 0 && token.length <= 2_048 && !/[\r\n]/.test(token), "Challenge token file must contain exactly one non-empty line of at most 2048 characters.");
  return token;
}

async function fetchBounded(fetchImpl, url, options, timeoutMs, label, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...options, cache: "no-store", redirect: "error", signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (error instanceof ProductionAcceptanceError) throw error;
    fail(`${label} could not complete against the configured origin within the request limit.`);
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyText(response, maximumBytes, label) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    fail(`${label} exceeded the ${maximumBytes}-byte response limit.`);
  }
  assert(response.body !== null, `${label} returned an empty response body.`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        fail(`${label} exceeded the ${maximumBytes}-byte response limit.`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

async function parseJsonResponse(response, expectedUrl, label) {
  assert(response.status === 200, `${label} returned HTTP ${response.status}.`);
  if (typeof response.url === "string" && response.url.length > 0) {
    assert(response.url === expectedUrl, `${label} redirected away from the configured origin.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.toLowerCase().includes("application/json"), `${label} did not return JSON.`);
  try {
    return JSON.parse(await readBodyText(response, MAX_JSON_BODY_BYTES, label));
  } catch (error) {
    if (error instanceof ProductionAcceptanceError) throw error;
    fail(`${label} returned malformed JSON.`);
  }
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} returned malformed JSON.`);
  }
}

async function getJson(fetchImpl, url, timeoutMs, label) {
  return fetchBounded(fetchImpl, url, {
    method: "GET",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  }, timeoutMs, label, async response => ({ response, body: await parseJsonResponse(response, url, label) }));
}

function uncachedUrl(context, path) {
  context.cacheRequestId += 1;
  const url = new URL(path, context.origin);
  url.searchParams.set("turnplay_acceptance", `${context.cacheNonce}-${context.cacheRequestId}`);
  return url.toString();
}

function parseEventStream(source, expectedId, label) {
  for (const block of source.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .join("\n");
    if (data.length === 0 || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.id === expectedId) return parsed;
    } catch {
      fail(`${label} returned malformed event-stream JSON.`);
    }
  }
  fail(`${label} did not return the requested JSON-RPC response.`);
}

async function mcpRequest(context, method, params) {
  context.requestId += 1;
  const id = context.requestId;
  const endpoint = `${context.origin}/mcp`;
  const label = `MCP ${method}`;
  return fetchBounded(context.fetchImpl, endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Pragma: "no-cache",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }, context.timeoutMs, label, async response => {
    assert(response.status === 200, `${label} returned HTTP ${response.status}.`);
    if (context.expectedBootId !== undefined) {
      assert(bootIdFrom(response, label) === context.expectedBootId, `${label} was served by a different provider process.`);
    }
    if (typeof response.url === "string" && response.url.length > 0) {
      assert(response.url === endpoint, `${label} redirected away from the configured origin.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const body = await readBodyText(response, MAX_JSON_BODY_BYTES, label);
    let envelope;
    if (contentType.includes("text/event-stream")) {
      envelope = parseEventStream(body, id, label);
    } else {
      assert(contentType.includes("application/json"), `${label} did not return JSON or an event stream.`);
      envelope = parseJsonText(body, label);
    }
    assert(envelope?.jsonrpc === "2.0" && envelope.id === id, `${label} returned a mismatched JSON-RPC envelope.`);
    assert(envelope.error === undefined, `${label} returned a JSON-RPC error.`);
    assert(envelope.result !== undefined, `${label} omitted its result.`);
    return envelope.result;
  });
}

function assertSecurityHeaders(response) {
  assert(response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff", "Health response is missing X-Content-Type-Options: nosniff.");
  assert(response.headers.get("referrer-policy")?.toLowerCase() === "no-referrer", "Health response is missing Referrer-Policy: no-referrer.");
  assert(response.headers.get("x-powered-by") === null, "Health response exposes X-Powered-By.");
  const csp = response.headers.get("content-security-policy") ?? "";
  for (const directive of ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
    assert(csp.includes(directive), `Health response CSP is missing ${directive}.`);
  }
}

function bootIdFrom(response, label) {
  const bootId = response.headers.get("x-turnplay-boot-id") ?? "";
  assert(/^[0-9a-f]{32}$/.test(bootId), `${label} is missing a valid per-process boot identity.`);
  assert((response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store"), `${label} boot identity must use Cache-Control: no-store.`);
  return bootId;
}

async function verifyChallenge(context, required, expectedToken, expectedDigest) {
  const endpoint = uncachedUrl(context, "/.well-known/openai-apps-challenge");
  return fetchBounded(context.fetchImpl, endpoint, {
    method: "GET",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  }, context.timeoutMs, "OpenAI domain challenge", async response => {
    if (context.expectedBootId !== undefined) {
      assert(bootIdFrom(response, "OpenAI domain challenge") === context.expectedBootId, "OpenAI domain challenge was served by a different provider process.");
    }
    if (response.status === 404) {
      assert(!required && expectedToken === undefined && expectedDigest === undefined, "OpenAI domain challenge is required but not configured.");
      await readBodyText(response, MAX_CHALLENGE_BODY_BYTES, "OpenAI domain challenge");
      return { present: false, exact: false, digest: null };
    }
    assert(response.status === 200, `OpenAI domain challenge returned HTTP ${response.status}.`);
    if (typeof response.url === "string" && response.url.length > 0) {
      assert(response.url === endpoint, "OpenAI domain challenge redirected away from the configured origin.");
    }
    assert((response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store"), "OpenAI domain challenge must use Cache-Control: no-store.");
    assert((response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/plain"), "OpenAI domain challenge did not return plain text.");
    const token = await readBodyText(response, MAX_CHALLENGE_BODY_BYTES, "OpenAI domain challenge");
    assert(token.length > 0 && token.length <= MAX_CHALLENGE_BODY_BYTES && !/[\r\n]/.test(token), "OpenAI domain challenge returned an invalid token.");
    const tokenBytes = Buffer.from(token, "utf8");
    if (expectedToken !== undefined) {
      const expectedBytes = Buffer.from(expectedToken, "utf8");
      assert(tokenBytes.length === expectedBytes.length && timingSafeEqual(tokenBytes, expectedBytes), "OpenAI domain challenge does not match the expected portal token.");
    }
    const digest = createHash("sha256").update(tokenBytes).digest("hex");
    if (expectedDigest !== undefined) assert(digest === expectedDigest, "OpenAI domain challenge changed after the seed phase.");
    return { present: true, exact: expectedToken !== undefined, digest };
  });
}

function assertTools(tools) {
  assert(Array.isArray(tools), "MCP tools/list did not return a tool array.");
  const names = tools.map(tool => tool?.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOL_NAMES), "MCP tool catalog does not match the eight reviewed tools.");
  for (const tool of tools) {
    const annotations = tool?.annotations;
    const expected = expectedAnnotations[tool.name];
    assert(isPlainObject(expected) && isPlainObject(annotations), `Tool ${tool?.name ?? "unknown"} is missing explicit annotations.`);
    exactKeys(annotations, Object.keys(expected), `Tool ${tool.name} annotations`);
    for (const [name, value] of Object.entries(expected)) {
      assert(annotations[name] === value, `Tool ${tool.name} has an incorrect ${name}.`);
    }
    assert(isPlainObject(tool.outputSchema), `Tool ${tool.name} is missing outputSchema.`);
  }
  const render = tools.find(tool => tool.name === "render_game");
  assert(render?._meta?.ui?.resourceUri === CURRENT_WIDGET_RESOURCE_URI, "render_game does not reference the current widget resource.");
  assert(render?._meta?.["openai/outputTemplate"] === CURRENT_WIDGET_RESOURCE_URI, "render_game outputTemplate does not reference the current widget resource.");
  const importedGo = tools.find(tool => tool.name === "import_go_position");
  assert(importedGo?._meta?.ui?.resourceUri === CURRENT_WIDGET_RESOURCE_URI, "import_go_position does not reference the current widget resource.");
  assert(importedGo?._meta?.["openai/outputTemplate"] === CURRENT_WIDGET_RESOURCE_URI, "import_go_position outputTemplate does not reference the current widget resource.");
}

export function validateWidgetResource(result, origin, expectedBundleDigest = CURRENT_WIDGET_BUNDLE_SHA256) {
  assert(typeof expectedBundleDigest === "string" && /^[0-9a-f]{64}$/.test(expectedBundleDigest), "Expected widget bundle digest is invalid.");
  assert(Array.isArray(result?.contents) && result.contents.length === 1, "Current widget resource did not return exactly one content item.");
  const content = result.contents[0];
  assert(content?.uri === CURRENT_WIDGET_RESOURCE_URI, "Current widget resource returned a mismatched URI.");
  assert(content?.mimeType?.toLowerCase() === "text/html;profile=mcp-app", "Current widget resource has the wrong MIME type.");
  assert(typeof content?.text === "string" && content.text.length > 10_000, "Current widget resource is missing its production bundle.");
  for (const marker of [CURRENT_WIDGET_RELEASE_MARKER, "Turnplay Arena", "formatVersion", "22rem"]) {
    assert(content.text.includes(marker), `Current widget resource is missing the ${marker} release marker.`);
  }
  assert(content?._meta?.ui?.domain === origin, "Widget domain does not equal the exact production origin.");
  assert(content?._meta?.ui?.prefersBorder === true, "Widget prefersBorder metadata is missing.");
  assert(Array.isArray(content?._meta?.ui?.csp?.connectDomains) && content._meta.ui.csp.connectDomains.length === 0, "Widget connect CSP is broader than the current app requires.");
  assert(Array.isArray(content?._meta?.ui?.csp?.resourceDomains) && content._meta.ui.csp.resourceDomains.length === 0, "Widget resource CSP is broader than the current app requires.");
  const frameDomains = content?._meta?.ui?.csp?.frameDomains;
  assert(frameDomains === undefined || (Array.isArray(frameDomains) && frameDomains.length === 0), "Widget frame CSP is broader than the current app requires.");
  const bundleDigest = createHash("sha256").update(content.text, "utf8").digest("hex");
  assert(bundleDigest === expectedBundleDigest, "Current widget resource does not match the reviewed v22 bundle digest.");
  return content;
}

function assertExactSnapshot(snapshot, expected, label) {
  exactKeys(snapshot, Object.keys(expected), label);
  assert(JSON.stringify(canonicalize(snapshot)) === JSON.stringify(canonicalize(expected)), `${label} did not match the exact reviewed snapshot.`);
}

export function validateConfirmationReceipt(text, prefix, expected) {
  assert(typeof text === "string" && text.startsWith(prefix), "Tool did not return the expected confirmation receipt prefix.");
  const serialized = text.slice(prefix.length);
  assert(serialized.length > 0 && serialized.trim() === serialized, "Confirmation receipt contains unexpected surrounding text.");
  let receipt;
  try {
    receipt = JSON.parse(serialized);
  } catch {
    fail("Confirmation receipt contains malformed JSON.");
  }
  exactKeys(receipt, Object.keys(expected), "Confirmation receipt");
  assert(JSON.stringify(canonicalize(receipt)) === JSON.stringify(canonicalize(expected)), "Confirmation receipt does not match the requested mutation.");
  return receipt;
}

async function callTool(context, name, argumentsValue, expectedText, expectedReceipt) {
  const result = await mcpRequest(context, "tools/call", { name, arguments: argumentsValue });
  assert(result?.isError !== true, `${name} returned a tool error.`);
  assert(Array.isArray(result?.content) && result.content.length === 1 && result.content[0]?.type === "text" && typeof result.content[0].text === "string", `${name} omitted its exact confirmation text.`);
  if (expectedReceipt === undefined) {
    assert(result.content[0].text === expectedText, `${name} did not return the expected confirmation text.`);
  } else {
    validateConfirmationReceipt(result.content[0].text, expectedText, expectedReceipt);
  }
  assert(isPlainObject(result.structuredContent), `${name} omitted structuredContent.`);
  return result.structuredContent;
}

async function verifyCommon(context, requireChallenge, expectedChallengeToken, expectedChallengeDigest) {
  const healthUrl = uncachedUrl(context, "/health");
  const health = await getJson(context.fetchImpl, healthUrl, context.timeoutMs, "Health check");
  assertSecurityHeaders(health.response);
  assert(JSON.stringify(health.body) === JSON.stringify({ ok: true }), "Health check returned an unexpected body.");
  const bootId = bootIdFrom(health.response, "Health check");

  const readyUrl = uncachedUrl(context, "/ready");
  const ready = await getJson(context.fetchImpl, readyUrl, context.timeoutMs, "Readiness check");
  assert(JSON.stringify(ready.body) === JSON.stringify({ ready: true }), "Readiness check did not prove storage and widget availability.");
  assert(bootIdFrom(ready.response, "Readiness check") === bootId, "Health and readiness were served by different process identities.");
  context.expectedBootId = bootId;

  const challenge = await verifyChallenge(context, requireChallenge, expectedChallengeToken, expectedChallengeDigest);
  const initialized = await mcpRequest(context, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "turnplay-production-acceptance", version: "1.0.0" },
  });
  assert(initialized?.serverInfo?.name === "gpt-game-arena", "MCP initialize returned the wrong server name.");
  assert(initialized?.serverInfo?.version === "0.2.0", "MCP initialize returned the wrong server version.");
  assert(initialized?.protocolVersion === "2025-11-25", "MCP initialize negotiated an unexpected protocol version.");
  assert(isPlainObject(initialized?.capabilities?.tools), "MCP initialize did not advertise tool capabilities.");
  assert(isPlainObject(initialized?.capabilities?.resources), "MCP initialize did not advertise resource capabilities.");

  const listedTools = await mcpRequest(context, "tools/list", {});
  assertTools(listedTools?.tools);
  const listedResources = await mcpRequest(context, "resources/list", {});
  assert(Array.isArray(listedResources?.resources), "MCP resources/list did not return a resource array.");
  const currentResources = listedResources.resources.filter(resource => resource?.uri === CURRENT_WIDGET_RESOURCE_URI);
  assert(currentResources.length === 1, "MCP resources/list must expose the current v22 widget exactly once.");
  assert(currentResources[0]?.mimeType?.toLowerCase() === "text/html;profile=mcp-app", "MCP resources/list advertises the wrong current widget MIME type.");
  const widget = await mcpRequest(context, "resources/read", { uri: CURRENT_WIDGET_RESOURCE_URI });
  validateWidgetResource(widget, context.origin, context.widgetBundleDigest);
  const finalReadyUrl = uncachedUrl(context, "/ready");
  const finalReady = await getJson(context.fetchImpl, finalReadyUrl, context.timeoutMs, "Final readiness check");
  assert(JSON.stringify(finalReady.body) === JSON.stringify({ ready: true }), "Final readiness check did not prove storage and widget availability.");
  assert(bootIdFrom(finalReady.response, "Final readiness check") === bootId, "The provider process changed during one acceptance phase.");
  return { challenge, bootId };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function persistenceProjection(snapshot) {
  return canonicalize({
    gameId: snapshot.gameId,
    kind: snapshot.kind,
    difficulty: snapshot.difficulty,
    playerColor: snapshot.playerColor,
    turn: snapshot.turn,
    status: snapshot.status,
    stateVersion: snapshot.stateVersion,
    resetEpoch: snapshot.resetEpoch,
    board: snapshot.board,
    legalMoves: snapshot.legalMoves,
    moveHistory: snapshot.moveHistory,
    lastMove: snapshot.lastMove,
    message: snapshot.message,
  });
}

export function productionSnapshotDigest(snapshot) {
  return createHash("sha256").update(JSON.stringify(persistenceProjection(snapshot))).digest("hex");
}

function buildReceipt(origin, snapshot, challenge, seedBootId) {
  return {
    formatVersion: PRODUCTION_ACCEPTANCE_FORMAT_VERSION,
    origin,
    widgetResourceUri: CURRENT_WIDGET_RESOURCE_URI,
    createdAt: new Date().toISOString(),
    challengeRequired: challenge.present,
    challengeTokenDigest: challenge.digest,
    seedBootId,
    gameId: snapshot.gameId,
    expectedSnapshot: persistenceProjection(snapshot),
    snapshotDigest: productionSnapshotDigest(snapshot),
  };
}

export function validateProductionReceipt(value) {
  exactKeys(value, ["formatVersion", "origin", "widgetResourceUri", "createdAt", "challengeRequired", "challengeTokenDigest", "seedBootId", "gameId", "expectedSnapshot", "snapshotDigest"], "Acceptance receipt");
  assert(value.formatVersion === PRODUCTION_ACCEPTANCE_FORMAT_VERSION, "Acceptance receipt has an unsupported format version.");
  assert(typeof value.origin === "string" && value.origin.length > 0, "Acceptance receipt has an invalid origin.");
  assert(value.widgetResourceUri === CURRENT_WIDGET_RESOURCE_URI, "Acceptance receipt targets a stale widget resource.");
  assert(typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)), "Acceptance receipt has an invalid creation time.");
  assert(typeof value.challengeRequired === "boolean", "Acceptance receipt has an invalid challenge setting.");
  assert(value.challengeTokenDigest === null || (typeof value.challengeTokenDigest === "string" && /^[0-9a-f]{64}$/.test(value.challengeTokenDigest)), "Acceptance receipt has an invalid challenge digest.");
  assert(!value.challengeRequired || value.challengeTokenDigest !== null, "Acceptance receipt requires a challenge but has no challenge digest.");
  assert(typeof value.seedBootId === "string" && /^[0-9a-f]{32}$/.test(value.seedBootId), "Acceptance receipt has an invalid seed boot identity.");
  assert(typeof value.gameId === "string" && value.gameId.length > 0 && value.gameId.length <= 256, "Acceptance receipt has an invalid game ID.");
  assert(typeof value.snapshotDigest === "string" && /^[0-9a-f]{64}$/.test(value.snapshotDigest), "Acceptance receipt has an invalid state digest.");
  assertExactSnapshot(value.expectedSnapshot, expectedFinalSnapshot(value.gameId), "Acceptance receipt expectedSnapshot");
  assert(productionSnapshotDigest(value.expectedSnapshot) === value.snapshotDigest, "Acceptance receipt state does not match its digest.");
  return value;
}

async function reserveReceipt(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    return await open(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") fail("Acceptance receipt already exists; resume it or remove it intentionally before creating another seed.");
    fail("Acceptance receipt could not be reserved safely.");
  }
}

async function writeReceipt(handle, receipt) {
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch {
    fail("Acceptance receipt could not be finalized safely; the reservation was retained to prevent an unsafe repeated seed.");
  }
}

async function readReceipt(path) {
  const raw = await readPrivateFile(path, "Acceptance receipt", MAX_PRIVATE_RECEIPT_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Acceptance receipt is not valid JSON.");
  }
  return validateProductionReceipt(parsed);
}

async function verifyBootStable(context, expectedBootId) {
  for (const [path, body, label] of [["/health", { ok: true }, "Post-operation health check"], ["/ready", { ready: true }, "Post-operation readiness check"]]) {
    const endpoint = uncachedUrl(context, path);
    const result = await getJson(context.fetchImpl, endpoint, context.timeoutMs, label);
    assert(JSON.stringify(result.body) === JSON.stringify(body), `${label} returned an unexpected body.`);
    assert(bootIdFrom(result.response, label) === expectedBootId, "The provider process changed during one acceptance phase.");
  }
}

async function runSeed(context, stateFile, receiptHandle, requireChallenge, expectedChallengeToken) {
  const common = await verifyCommon(context, requireChallenge, expectedChallengeToken);
  assert(!context.production || common.challenge.exact, "Production acceptance requires an exact OpenAI portal challenge token match.");
  const created = await callTool(context, "create_game", {
    game: "tic-tac-toe",
    playerColor: "black",
    difficulty: "hard",
  }, "Created game.");
  assert(typeof created.gameId === "string" && created.gameId.length > 0, "create_game returned an invalid game ID.");
  assertExactSnapshot(created, expectedOpeningSnapshot(created.gameId), "create_game");

  const rendered = await callTool(context, "render_game", { gameId: created.gameId }, "Rendered game.");
  assertExactSnapshot(rendered, created, "initial render_game");

  const playerMove = await callTool(context, "play_game_move", {
    gameId: created.gameId,
    actor: "player",
    move: "A3",
    expectedVersion: 0,
    expectedResetEpoch: 0,
  }, "MOVE_CONFIRMED ", {
    gameId: created.gameId,
    resetEpoch: 0,
    actor: "player",
    move: "A3",
    previousVersion: 0,
    stateVersion: 1,
  });
  assertExactSnapshot(playerMove, expectedPlayerSnapshot(created.gameId), "player move");

  const gptMove = await callTool(context, "play_game_move", {
    gameId: created.gameId,
    actor: "gpt",
    move: "B2",
    expectedVersion: 1,
    expectedResetEpoch: 0,
  }, "MOVE_CONFIRMED ", {
    gameId: created.gameId,
    resetEpoch: 0,
    actor: "gpt",
    move: "B2",
    previousVersion: 1,
    stateVersion: 2,
  });
  assertExactSnapshot(gptMove, expectedFinalSnapshot(created.gameId), "GPT move");

  const reread = await callTool(context, "get_game_state", { gameId: created.gameId }, "Retrieved game state.");
  assertExactSnapshot(reread, gptMove, "Seed state read");
  await verifyBootStable(context, common.bootId);
  const receipt = buildReceipt(context.origin, reread, common.challenge, common.bootId);
  await writeReceipt(receiptHandle, receipt);
  return {
    phase: "seed",
    production: context.production,
    origin: context.origin,
    widgetResourceUri: CURRENT_WIDGET_RESOURCE_URI,
    stateVersion: 2,
    resetEpoch: 0,
    challengePresent: common.challenge.present,
    challengeExact: common.challenge.exact,
    restartProven: false,
    snapshotDigest: receipt.snapshotDigest,
    stateFile,
  };
}

async function runResume(context, stateFile, requireChallenge, expectedChallengeToken) {
  const receipt = await readReceipt(stateFile);
  assert(receipt.origin === context.origin, "Acceptance receipt belongs to a different production origin.");
  const common = await verifyCommon(context, requireChallenge || receipt.challengeRequired, expectedChallengeToken, receipt.challengeTokenDigest ?? undefined);
  assert(!context.production || common.challenge.exact, "Production acceptance requires an exact OpenAI portal challenge token match.");
  assert(common.bootId !== receipt.seedBootId, "Provider process boot identity did not change; an actual restart was not proven.");
  const state = await callTool(context, "get_game_state", { gameId: receipt.gameId }, "Retrieved game state.");
  assertExactSnapshot(state, receipt.expectedSnapshot, "Post-restart state");
  assert(productionSnapshotDigest(state) === receipt.snapshotDigest, "Post-restart state digest does not match the seeded state.");
  const rendered = await callTool(context, "render_game", { gameId: receipt.gameId }, "Rendered game.");
  assertExactSnapshot(rendered, receipt.expectedSnapshot, "Post-restart render");
  assert(productionSnapshotDigest(rendered) === receipt.snapshotDigest, "Post-restart render does not match the seeded state.");
  await verifyBootStable(context, common.bootId);
  return {
    phase: "resume",
    production: context.production,
    origin: context.origin,
    widgetResourceUri: CURRENT_WIDGET_RESOURCE_URI,
    stateVersion: state.stateVersion,
    resetEpoch: state.resetEpoch,
    challengePresent: common.challenge.present,
    challengeExact: common.challenge.exact,
    restartProven: true,
    snapshotDigest: receipt.snapshotDigest,
    stateFile,
  };
}

export async function runProductionAcceptance({
  phase,
  baseUrl,
  stateFile,
  challengeTokenFile,
  localExpectedWidgetDigest,
  requireChallenge = false,
  allowHttpLocalhost = false,
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
}) {
  assert(phase === "seed" || phase === "resume", "Production acceptance phase must be seed or resume.");
  assert(typeof fetchImpl === "function", "A fetch implementation is required.");
  assert(typeof stateFile === "string" && stateFile.length > 0, "A private acceptance state file is required.");
  assert(challengeTokenFile === undefined || (typeof challengeTokenFile === "string" && challengeTokenFile.length > 0), "challengeTokenFile must be a non-empty path when provided.");
  assert(localExpectedWidgetDigest === undefined || (typeof localExpectedWidgetDigest === "string" && /^[0-9a-f]{64}$/.test(localExpectedWidgetDigest)), "localExpectedWidgetDigest must be a SHA-256 digest when provided.");
  assert(typeof requireChallenge === "boolean", "requireChallenge must be boolean.");
  assert(typeof allowHttpLocalhost === "boolean", "allowHttpLocalhost must be boolean.");
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000, "timeoutMs must be an integer between 1000 and 60000.");
  const origin = normalizeProductionOrigin(baseUrl, { allowHttpLocalhost });
  const resolvedStateFile = resolve(stateFile);
  const production = origin.startsWith("https://");
  assert(!production || challengeTokenFile !== undefined, "Production acceptance requires --challenge-token-file with the exact OpenAI portal token.");
  assert(!production || localExpectedWidgetDigest === undefined, "A production acceptance run cannot override the reviewed widget bundle digest.");
  const expectedChallengeToken = challengeTokenFile === undefined ? undefined : await readChallengeTokenFile(resolve(challengeTokenFile));
  const context = {
    origin,
    production,
    widgetBundleDigest: localExpectedWidgetDigest ?? CURRENT_WIDGET_BUNDLE_SHA256,
    timeoutMs,
    fetchImpl,
    requestId: 0,
    cacheNonce: randomBytes(8).toString("hex"),
    cacheRequestId: 0,
  };
  if (phase === "resume") {
    return runResume(context, resolvedStateFile, requireChallenge || expectedChallengeToken !== undefined, expectedChallengeToken);
  }
  const receiptHandle = await reserveReceipt(resolvedStateFile);
  try {
    return await runSeed(context, resolvedStateFile, receiptHandle, requireChallenge || expectedChallengeToken !== undefined, expectedChallengeToken);
  } catch (error) {
    if (error instanceof ProductionAcceptanceError) {
      fail(`${error.message} The private seed receipt reservation was retained; reconcile the run before removing it or trying again.`);
    }
    fail("Seed acceptance failed unexpectedly. The private receipt reservation was retained; reconcile the run before removing it or trying again.");
  } finally {
    await receiptHandle.close().catch(() => undefined);
  }
}
