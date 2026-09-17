export const PRODUCTION_ACCEPTANCE_FORMAT_VERSION: 1;
export const CURRENT_WIDGET_RESOURCE_URI: "ui://gpt-game-arena/v22/widget.html";
export const CURRENT_WIDGET_RELEASE_MARKER: "turnplay-v22-20260916-opponent";
export const CURRENT_WIDGET_BUNDLE_SHA256: "0990fe5182bce70c3159ff8bb92d4e7e84f2771c078b63776d4bfa902989dee6";
export const EXPECTED_TOOL_NAMES: string[];

export class ProductionAcceptanceError extends Error {}

export type ProductionAcceptanceOptions = {
  phase: "seed" | "resume";
  baseUrl: string;
  stateFile: string;
  challengeTokenFile?: string;
  localExpectedWidgetDigest?: string;
  requireChallenge?: boolean;
  allowHttpLocalhost?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ProductionAcceptanceResult = {
  phase: "seed" | "resume";
  production: boolean;
  origin: string;
  widgetResourceUri: string;
  stateVersion: number;
  resetEpoch: number;
  challengePresent: boolean;
  challengeExact: boolean;
  restartProven: boolean;
  snapshotDigest: string;
  stateFile: string;
};

export function normalizeProductionOrigin(value: string, options?: { allowHttpLocalhost?: boolean }): string;
export function parseProductionAcceptanceArgs(argv: string[], cwd?: string): {
  phase: "seed" | "resume" | undefined;
  baseUrl: string | undefined;
  stateFile: string;
  challengeTokenFile: string | undefined;
  requireChallenge: boolean;
  allowHttpLocalhost: boolean;
  help: boolean;
};
export function productionSnapshotDigest(snapshot: Record<string, unknown>): string;
export function readChallengeTokenFile(path: string): Promise<string>;
export function validateConfirmationReceipt(text: string, prefix: string, expected: Record<string, unknown>): Record<string, unknown>;
export function validateWidgetResource(result: unknown, origin: string, expectedBundleDigest?: string): Record<string, unknown>;
export function validateProductionReceipt(value: unknown): Record<string, unknown>;
export function runProductionAcceptance(options: ProductionAcceptanceOptions): Promise<ProductionAcceptanceResult>;
