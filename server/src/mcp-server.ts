import { readFile } from "node:fs/promises";

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import {
  executeTool,
  isGameRuleError,
  mcpGameSnapshotSummarySchema,
  mcpToolInputSchemas,
  toolInputSchemas,
  toToolFailure,
} from "./tool-contracts.js";
import { ToolService } from "./tool-service.js";
import {
  elapsedMilliseconds,
  recordOperationalEvent,
  type OperationalTelemetry,
  type ToolCallOutcome,
} from "./telemetry.js";

export const WIDGET_RESOURCE_URI = "ui://gpt-game-arena/v22/widget.html";
export const LEGACY_WIDGET_RESOURCE_URIS = ["ui://gpt-game-arena/v21/widget.html", "ui://gpt-game-arena/v20/widget.html", "ui://gpt-game-arena/v19/widget.html", "ui://gpt-game-arena/v18/widget.html", "ui://gpt-game-arena/v17/widget.html", "ui://gpt-game-arena/v16/widget.html", "ui://gpt-game-arena/v15/widget.html", "ui://gpt-game-arena/v14/widget.html", "ui://gpt-game-arena/v13/widget.html", "ui://gpt-game-arena/v12/widget.html", "ui://gpt-game-arena/v11/widget.html"] as const;
export const WIDGET_DESCRIPTION = "An interactive Mini 8-Ball, Court Duel basketball, chess, Reversi, Tic-Tac-Toe, Connect Four, or 9x9, 13x13, or 19x19 Go game, including Go positions transcribed from an attached photo.";
export type WidgetLoader = () => string | undefined | Promise<string | undefined>;

export interface McpServerOptions {
  loadWidgetHtml?: WidgetLoader;
  widgetDomain?: string;
  telemetry?: OperationalTelemetry;
  now?: () => number;
}

interface ToolTelemetryOptions {
  telemetry?: OperationalTelemetry;
  now: () => number;
}

export function createMcpServer(service: ToolService, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "gpt-game-arena", version: "0.2.0" });
  const loadWidgetHtml = options.loadWidgetHtml ?? defaultWidgetLoader;
  const instrumentation: ToolTelemetryOptions = {
    telemetry: options.telemetry,
    now: options.now ?? Date.now,
  };

  for (const resourceUri of [WIDGET_RESOURCE_URI, ...LEGACY_WIDGET_RESOURCE_URIS]) {
    registerWidgetResource(server, resourceUri, loadWidgetHtml, options.widgetDomain);
  }

  registerTool(server, service, "create_game", "Create game", "Use this when starting Mini 8-Ball Pool, Court Duel basketball, chess, Reversi, Tic-Tac-Toe, Connect Four, or Go. Set difficulty to easy, medium, or hard; an omitted difficulty defaults to medium. For Go, set boardSize to 9, 13, or 19; an omitted boardSize defaults to 9. Pool and basketball use their finite legal move strings exactly as returned by the snapshot. After a successful confirmed create, call render_game exactly once with the returned gameId to show the interactive board. This tool is data-only and does not render a widget.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } }, instrumentation);
  registerTool(server, service, "import_go_position", "Continue Go from a photo", "Use this when, and only when, the user wants to continue an existing Go position from an attached board image or an explicit stone list. Inspect the image yourself and transcribe every visible stone into blackStones and whiteStones. Unless visible labels establish another orientation, map the image's left edge to column A and its top edge to the highest rank; Go columns skip I. Map roles literally: 'I am White' means playerColor white, while 'you/GPT are White' means playerColor black. Set turn to the color that moves next. If board size, any stone color or intersection, the requested role, or the next turn is genuinely unclear, ask one concise question before calling. Captures may be omitted when unknown and then start at zero. Only claim the position opened after a matching IMPORT_CONFIRMED receipt. The widget will ask the user to verify the transcription; do not make a game move until that review is accepted. For a correction before play, call this tool again with the complete corrected position instead of using play_game_move for setup stones.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, {
    ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] },
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
  }, instrumentation);
  registerTool(server, service, "confirm_imported_go_position", "Confirm imported Go position", "Use this when the user clicks the widget confirmation after checking an imported Go board. Success returns IMPORT_REVIEW_CONFIRMED; never retry IMPORT_REVIEW_CONFIRMATION_UNKNOWN.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["app"] } }, instrumentation);
  registerTool(server, service, "get_game_state", "Get game state", "Use this when you need the authoritative current game state.", {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  }, { ui: { visibility: ["model", "app"] } }, instrumentation);
  registerTool(server, service, "play_game_move", "Play game move", "Use this when applying exactly one legal move with expectedResetEpoch and expectedVersion. Only claim that a move landed after a matching MOVE_CONFIRMED receipt. MOVE_NOT_APPLIED is definite; MOVE_CONFIRMATION_UNKNOWN requires a read-only state check and must never trigger a repeated mutation.", {
    readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } }, instrumentation);
  registerTool(server, service, "end_game", "End game", "Use this when, and only when, the player explicitly confirms ending the active game. Supply confirmed true and the authoritative expectedResetEpoch and expectedVersion; only claim that it ended after a matching END_CONFIRMED receipt. END_NOT_APPLIED is definite; END_CONFIRMATION_UNKNOWN requires a read-only state check and must never trigger a repeated mutation.", {
    readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } }, instrumentation);
  registerTool(server, service, "reset_game", "Reset game", "Use this when, and only when, the player explicitly confirms erasing the current game progress. Supply confirmed true and the authoritative expectedResetEpoch and expectedVersion; only claim that it reset after a matching RESET_CONFIRMED receipt. RESET_NOT_APPLIED is definite; RESET_CONFIRMATION_UNKNOWN requires one read-only state check and must never trigger a repeated mutation.", {
    readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false,
  }, { ui: { visibility: ["model", "app"] } }, instrumentation);
  registerTool(server, service, "render_game", "Render game", "Use this when performing the UI render step for an existing normal game, especially immediately after create_game. Use the exact gameId returned by create_game and call it once. This tool does not create or mutate a game. Do not call it after import_go_position because that tool owns the widget render.", {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  }, {
    ui: { resourceUri: WIDGET_RESOURCE_URI, visibility: ["model"] },
    "openai/outputTemplate": WIDGET_RESOURCE_URI,
  }, instrumentation);

  return server;
}

function registerWidgetResource(
  server: McpServer,
  resourceUri: string,
  loadWidgetHtml: WidgetLoader,
  widgetDomain: string | undefined,
): void {
  registerAppResource(server, "Turnplay Arena", resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: resourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: await loadWidgetHtmlSafely(loadWidgetHtml),
      _meta: {
        ui: {
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: [] },
          ...(widgetDomain === undefined ? {} : { domain: widgetDomain }),
        },
        "openai/widgetDescription": WIDGET_DESCRIPTION,
      },
    }],
  }));
}

function registerTool(
  server: McpServer,
  service: ToolService,
  name: keyof typeof toolInputSchemas,
  title: string,
  description: string,
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint: boolean },
  meta: Record<string, unknown>,
  instrumentation: ToolTelemetryOptions,
): void {
  registerAppTool(server, name, {
    title,
    description,
    inputSchema: mcpToolInputSchemas[name] as unknown as AnySchema,
    outputSchema: mcpGameSnapshotSummarySchema as unknown as AnySchema,
    annotations,
    _meta: {
      ...meta,
      "openai/toolInvocation/invoking": "Working…",
      "openai/toolInvocation/invoked": "Done.",
    },
  }, async (input: unknown) => {
    const startedAt = instrumentation.now();
    let outcome: ToolCallOutcome = "error";
    try {
      const result = executeTool(service, name, input);
      outcome = "success";
      return result;
    } catch (error) {
      const mutation = name === "play_game_move"
        ? "move"
        : name === "end_game"
          ? "end"
          : name === "reset_game"
            ? "reset"
            : name === "import_go_position"
              ? "import"
              : name === "confirm_imported_go_position"
                ? "import-review"
                : undefined;
      if (isGameRuleError(error)) {
        outcome = "rejected";
        return toToolFailure(error, mutation);
      }
      const prefix = mutation === "move"
        ? "MOVE_CONFIRMATION_UNKNOWN "
        : mutation === "end"
          ? "END_CONFIRMATION_UNKNOWN "
          : mutation === "reset"
            ? "RESET_CONFIRMATION_UNKNOWN "
            : mutation === "import"
              ? "IMPORT_CONFIRMATION_UNKNOWN "
              : mutation === "import-review"
                ? "IMPORT_REVIEW_CONFIRMATION_UNKNOWN "
                : "";
      return { isError: true, content: [{ type: "text" as const, text: `${prefix}internal_error: Internal server error.` }] };
    } finally {
      recordOperationalEvent(instrumentation.telemetry, {
        event: "tool_call",
        transport: "mcp",
        tool: name,
        outcome,
        durationMs: elapsedMilliseconds(startedAt, instrumentation.now()),
      });
    }
  });
}

export async function defaultWidgetLoader(): Promise<string | undefined> {
  try {
    return await readFile(new URL("../../web/dist/index.html", import.meta.url), "utf8");
  } catch {
    return undefined;
  }
}

export function missingWidgetHtml(): string {
  return "<!doctype html><html><body><p>Build the widget first with npm run build --workspace web.</p></body></html>";
}

async function loadWidgetHtmlSafely(loadWidgetHtml: WidgetLoader): Promise<string> {
  try {
    return (await loadWidgetHtml()) ?? missingWidgetHtml();
  } catch {
    return missingWidgetHtml();
  }
}
