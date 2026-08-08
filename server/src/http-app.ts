import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";

import { createMcpServer, defaultWidgetLoader, type WidgetLoader } from "./mcp-server.js";
import { executeTool, isGameRuleError, isToolOutputError, toolInputSchemas, type ToolName } from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";

const PROCESS_BOOT_ID = randomBytes(16).toString("hex");
import {
  elapsedMilliseconds,
  normalizeHttpMethod,
  recordOperationalEvent,
  type HttpSurface,
  type McpOperation,
  type OperationalTelemetry,
  type ToolCallOutcome,
} from "./telemetry.js";

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  maxBuckets?: number;
}

export interface HttpAppOptions {
  loadWidgetHtml?: WidgetLoader;
  widgetDomain?: string;
  openAiAppsChallengeToken?: string;
  trustedProxyCidrs?: readonly string[];
  trustedProxyHops?: number;
  rateLimitClientIpSource?: "express" | "render-cf-connecting-ip";
  telemetry?: OperationalTelemetry;
  now?: () => number;
  apiToolsRateLimit?: RateLimitOptions;
  mcpRateLimit?: RateLimitOptions;
  apiToolsGlobalRateLimit?: RateLimitOptions;
  mcpGlobalRateLimit?: RateLimitOptions;
}

interface RateBucket { windowStart: number; count: number }
interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const UNSUPPORTED_MEDIA_ERROR_CODE = -32015;

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions, now: () => number) {
    this.limit = positiveSafeInteger(options.limit ?? 60, "limit");
    this.windowMs = positiveSafeInteger(options.windowMs ?? 60_000, "windowMs");
    this.maxBuckets = positiveSafeInteger(options.maxBuckets ?? 1_000, "maxBuckets");
    this.now = now;
  }

  consume(clientKey: string): RateLimitDecision {
    const now = nonnegativeSafeInteger(this.now(), "clock");
    this.prune(now);
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const current = this.buckets.get(clientKey);
    if (current && current.windowStart === windowStart) {
      if (current.count >= this.limit) return this.decision(false, 0, windowStart, now);
      current.count += 1;
      return this.decision(true, this.limit - current.count, windowStart, now);
    }
    if (!current && this.buckets.size >= this.maxBuckets) {
      return this.decision(false, 0, windowStart, now);
    }
    this.buckets.set(clientKey, { windowStart, count: 1 });
    return this.decision(true, this.limit - 1, windowStart, now);
  }

  bucketCount(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    for (const [clientKey, bucket] of this.buckets) {
      if (now >= bucket.windowStart + this.windowMs) this.buckets.delete(clientKey);
    }
  }

  private decision(allowed: boolean, remaining: number, windowStart: number, now: number): RateLimitDecision {
    return {
      allowed,
      limit: this.limit,
      remaining,
      retryAfterSeconds: retryAfter(windowStart, this.windowMs, now),
    };
  }
}

export function createHttpApp(service: ToolService, options: HttpAppOptions = {}) {
  const app = express();
  const now = options.now ?? Date.now;
  const bootId = PROCESS_BOOT_ID;
  const loadWidgetHtml = options.loadWidgetHtml ?? defaultWidgetLoader;
  const apiLimiter = new FixedWindowLimiter(options.apiToolsRateLimit ?? {}, now);
  const mcpLimiter = new FixedWindowLimiter({ limit: 120, ...options.mcpRateLimit }, now);
  const apiGlobalLimiter = new FixedWindowLimiter({ limit: 600, maxBuckets: 1, ...options.apiToolsGlobalRateLimit }, now);
  const mcpGlobalLimiter = new FixedWindowLimiter({ limit: 1_200, maxBuckets: 1, ...options.mcpGlobalRateLimit }, now);
  const rateLimitKeySecret = randomBytes(32).toString("hex");
  const rateLimitClientIpSource = options.rateLimitClientIpSource ?? "express";
  if (rateLimitClientIpSource === "render-cf-connecting-ip"
    && (options.trustedProxyHops !== undefined || (options.trustedProxyCidrs?.length ?? 0) > 0)) {
    throw new RangeError("Render client-IP mode must not be combined with Express proxy trust.");
  }

  app.disable("x-powered-by");
  if (options.trustedProxyHops !== undefined) {
    app.set("trust proxy", options.trustedProxyHops);
  } else if (options.trustedProxyCidrs && options.trustedProxyCidrs.length > 0) {
    app.set("trust proxy", [...options.trustedProxyCidrs]);
  }
  app.use((_, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    next();
  });
  if (options.telemetry !== undefined) {
    app.use((request, response, next) => {
      const startedAt = now();
      const surface = httpSurface(request.path);
      response.once("finish", () => {
        recordOperationalEvent(options.telemetry, {
          event: "http_request",
          surface,
          method: normalizeHttpMethod(request.method),
          status: response.statusCode,
          durationMs: elapsedMilliseconds(startedAt, now()),
          ...(surface === "mcp" ? { mcpOperation: mcpOperation(request.body) } : {}),
        });
      });
      next();
    });
  }
  app.use("/api/tools", rateLimitMiddleware(
    apiLimiter,
    apiGlobalLimiter,
    "rest",
    rateLimitKeySecret,
    rateLimitClientIpSource,
  ));
  app.use("/mcp", rateLimitMiddleware(
    mcpLimiter,
    mcpGlobalLimiter,
    "mcp",
    rateLimitKeySecret,
    rateLimitClientIpSource,
  ));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_, response) => {
    setBootIdentity(response, bootId);
    response.status(200).json({ ok: true });
  });
  app.get("/ready", async (_, response) => {
    setBootIdentity(response, bootId);
    try {
      if (!(await service.checkReadiness())) throw new Error("Game storage unavailable.");
      const html = await loadWidgetHtml();
      if (html === undefined) throw new Error("Widget build unavailable.");
      response.status(200).json({ ready: true });
    } catch {
      response.status(503).json({ ready: false });
    }
  });
  app.get("/.well-known/openai-apps-challenge", (_, response) => {
    setBootIdentity(response, bootId);
    if (options.openAiAppsChallengeToken === undefined) {
      response.status(404).type("text/plain").send("Not found.");
      return;
    }
    response.status(200).type("text/plain").send(options.openAiAppsChallengeToken);
  });
  app.get("/preview", async (_, response) => {
    let html: string | undefined;
    try {
      html = await loadWidgetHtml();
    } catch {
      html = undefined;
    }
    if (html === undefined) {
      response.status(503).type("text/plain").send("Widget build is unavailable. Run npm run build --workspace web.");
      return;
    }
    response.status(200).type("html").send(html);
  });

  app.post("/api/tools/:name", (request, response) => {
    const name = request.params.name ?? "";
    if (!isToolName(name)) {
      response.status(404).json({ error: { code: "not_found", message: "Tool was not found." } });
      return;
    }
    const startedAt = now();
    let outcome: ToolCallOutcome = "error";
    try {
      const result = executeTool(service, name, request.body);
      outcome = "success";
      response.status(200).json(result);
    } catch (error) {
      if (isToolOutputError(error)) {
        response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
        return;
      }
      if (error instanceof ZodError) {
        outcome = "rejected";
        response.status(400).json({ error: { code: "invalid_input", message: "Invalid tool input." } });
        return;
      }
      if (isGameRuleError(error)) {
        outcome = "rejected";
        response.status(409).json({ error: { code: error.code, message: "The requested game operation could not be completed." } });
        return;
      }
      response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
    } finally {
      recordOperationalEvent(options.telemetry, {
        event: "tool_call",
        transport: "rest",
        tool: name,
        outcome,
        durationMs: elapsedMilliseconds(startedAt, now()),
      });
    }
  });

  app.all("/mcp", async (request, response) => {
    setBootIdentity(response, bootId);
    const server = createMcpServer(service, {
      loadWidgetHtml,
      widgetDomain: options.widgetDomain,
      telemetry: options.telemetry,
      now,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let cleanupPromise: Promise<void> | undefined;
    const close = (): Promise<void> => cleanupPromise ??= Promise.allSettled([transport.close(), server.close()]).then(() => undefined);
    response.once("close", () => { void close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error." } });
      }
      await close();
    }
  });

  app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    if (isUnsupportedMediaError(error)) {
      if (request.path === "/mcp") {
        response.status(415).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: UNSUPPORTED_MEDIA_ERROR_CODE, message: "Unsupported JSON media type." },
        });
        return;
      }
      response.status(415).json({ error: { code: "unsupported_media_type", message: "Unsupported JSON media type." } });
      return;
    }
    if (request.path === "/mcp" && (isPayloadTooLarge(error) || isJsonParseError(error))) {
      response.status(isPayloadTooLarge(error) ? 413 : 400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." },
      });
      return;
    }
    if (isPayloadTooLarge(error)) {
      response.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large." } });
      return;
    }
    if (isJsonParseError(error)) {
      response.status(400).json({ error: { code: "invalid_json", message: "Invalid JSON request body." } });
      return;
    }
    if (request.path === "/mcp") {
      response.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error." } });
      return;
    }
    response.status(500).json({ error: { code: "internal_error", message: "Internal server error." } });
  });

  return app;
}

function setBootIdentity(response: Response, bootId: string): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Turnplay-Boot-Id", bootId);
}

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolInputSchemas, name);
}

function httpSurface(path: string): HttpSurface {
  if (path === "/health") return "health";
  if (path === "/ready") return "ready";
  if (path === "/.well-known/openai-apps-challenge") return "challenge";
  if (path === "/preview") return "preview";
  if (path === "/mcp") return "mcp";
  if (path === "/api/tools" || path.startsWith("/api/tools/")) return "rest-tools";
  return "other";
}

function mcpOperation(body: unknown): McpOperation {
  if (typeof body !== "object" || body === null || !("method" in body)) return "other";
  const method = body.method;
  return method === "initialize"
    || method === "tools/list"
    || method === "tools/call"
    || method === "resources/read"
    ? method
    : "other";
}

function retryAfter(windowStart: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1_000));
}

function rateLimitMiddleware(
  limiter: FixedWindowLimiter,
  globalLimiter: FixedWindowLimiter,
  kind: "rest" | "mcp",
  keySecret: string,
  clientIpSource: "express" | "render-cf-connecting-ip",
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const clientIdentity = rateLimitClientIdentity(request, clientIpSource);
    const clientKey = createHmac("sha256", keySecret).update(clientIdentity).digest("base64url");
    const clientLimit = limiter.consume(clientKey);
    if (!clientLimit.allowed) {
      sendRateLimitDecision(response, kind, clientLimit);
      return;
    }
    const globalLimit = globalLimiter.consume("global");
    const limit = !globalLimit.allowed || globalLimit.remaining < clientLimit.remaining
      ? globalLimit
      : clientLimit;
    response.setHeader("X-RateLimit-Limit", String(limit.limit));
    response.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    response.setHeader("X-RateLimit-Reset", String(limit.retryAfterSeconds));
    if (limit.allowed) return next();
    sendRateLimitDecision(response, kind, limit);
  };
}

function rateLimitClientIdentity(
  request: Request,
  source: "express" | "render-cf-connecting-ip",
): string {
  if (source === "express") return `express:${request.ip ?? "unknown"}`;
  const header = request.headers["cf-connecting-ip"];
  if (typeof header === "string" && header.length <= 45 && header === header.trim() && isIP(header) !== 0) {
    return `render-cf:${header}`;
  }
  return "render-cf:unverified";
}

function sendRateLimitDecision(
  response: Response,
  kind: "rest" | "mcp",
  limit: RateLimitDecision,
): void {
  response.setHeader("X-RateLimit-Limit", String(limit.limit));
  response.setHeader("X-RateLimit-Remaining", String(limit.remaining));
  response.setHeader("X-RateLimit-Reset", String(limit.retryAfterSeconds));
  response.setHeader("Retry-After", String(limit.retryAfterSeconds));
  if (kind === "mcp") {
    response.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "Too many requests." } });
    return;
  }
  response.status(429).json({ error: { code: "rate_limited", message: "Too many requests." } });
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function nonnegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer.`);
  return value;
}

function isPayloadTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}

function isJsonParseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed";
}

function isUnsupportedMediaError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "type" in error
    && "status" in error
    && error.status === 415
    && (error.type === "charset.unsupported" || error.type === "encoding.unsupported");
}
