import { isAbsolute } from "node:path";
import { isIP } from "node:net";

import {
  DEFAULT_GAME_STORE_MAX_SESSIONS,
  DEFAULT_GAME_STORE_TTL_MS,
  DEFAULT_LEGACY_BACKUP_TTL_MS,
  MAX_GAME_STORE_SESSIONS,
  type GameStoreOptions,
} from "./game-store.js";

type Environment = Readonly<Record<string, string | undefined>>;

export type GameStoreRuntimeOptions = Required<Pick<GameStoreOptions, "maxSessions" | "ttlMs" | "legacyBackupTtlMs">>;

export interface PublicAppRuntimeOptions {
  widgetDomain?: string;
  openAiAppsChallengeToken?: string;
  trustedProxyCidrs: readonly string[];
  trustedProxyHops?: number;
  rateLimitClientIpSource: "express" | "render-cf-connecting-ip";
}

export function gameStoreRuntimeOptionsFromEnvironment(
  environment: Environment = process.env,
): GameStoreRuntimeOptions {
  return {
    ttlMs: positiveSafeInteger(
      "GAME_STORE_TTL_MS",
      environment.GAME_STORE_TTL_MS,
      DEFAULT_GAME_STORE_TTL_MS,
    ),
    maxSessions: positiveSafeInteger(
      "GAME_STORE_MAX_SESSIONS",
      environment.GAME_STORE_MAX_SESSIONS,
      DEFAULT_GAME_STORE_MAX_SESSIONS,
      MAX_GAME_STORE_SESSIONS,
    ),
    legacyBackupTtlMs: positiveSafeInteger(
      "GAME_STORE_LEGACY_BACKUP_TTL_MS",
      environment.GAME_STORE_LEGACY_BACKUP_TTL_MS,
      DEFAULT_LEGACY_BACKUP_TTL_MS,
    ),
  };
}

export function publicAppRuntimeOptionsFromEnvironment(
  environment: Environment = process.env,
): PublicAppRuntimeOptions {
  const widgetDomain = optionalHttpsOrigin("PUBLIC_BASE_URL", environment.PUBLIC_BASE_URL);
  if (environment.NODE_ENV === "production" && widgetDomain === undefined) {
    throw new RangeError("PUBLIC_BASE_URL is required when NODE_ENV is production.");
  }
  if (environment.NODE_ENV === "production"
    && (environment.GAME_STORE_PATH === undefined || !isAbsolute(environment.GAME_STORE_PATH))) {
    throw new RangeError("GAME_STORE_PATH must be an absolute path when NODE_ENV is production.");
  }
  const trustedProxyCidrs = optionalTrustedProxyCidrs(
    "TRUSTED_PROXY_CIDRS",
    environment.TRUSTED_PROXY_CIDRS,
  );
  const trustedProxyHops = optionalTrustedProxyHops(
    "TRUST_PROXY_HOPS",
    environment.TRUST_PROXY_HOPS,
  );
  if (trustedProxyCidrs.length > 0 && trustedProxyHops !== undefined) {
    throw new RangeError("TRUSTED_PROXY_CIDRS and TRUST_PROXY_HOPS must not both be configured.");
  }
  const rateLimitClientIpSource = optionalRateLimitClientIpSource(
    "RATE_LIMIT_CLIENT_IP_SOURCE",
    environment.RATE_LIMIT_CLIENT_IP_SOURCE,
  );
  if (rateLimitClientIpSource === "render-cf-connecting-ip") {
    validateRenderClientIpSource(environment, widgetDomain, trustedProxyCidrs, trustedProxyHops);
  }
  return {
    widgetDomain,
    openAiAppsChallengeToken: optionalChallengeToken(
      "OPENAI_APPS_CHALLENGE_TOKEN",
      environment.OPENAI_APPS_CHALLENGE_TOKEN,
    ),
    trustedProxyCidrs,
    trustedProxyHops,
    rateLimitClientIpSource,
  };
}

function positiveSafeInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function optionalHttpsOrigin(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RangeError(`${name} must be an HTTPS origin.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new RangeError(`${name} must be an HTTPS origin.`);
  }
  return parsed.origin;
}

function optionalChallengeToken(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 2_048 || value.trim() !== value || /[\r\n]/.test(value)) {
    throw new RangeError(`${name} must be a non-empty single-line token of at most 2048 characters.`);
  }
  return value;
}

function optionalTrustedProxyCidrs(name: string, value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const entries = value.split(",").map(entry => entry.trim());
  if (entries.length > 32 || entries.some(entry => entry.length === 0)) {
    throw new RangeError(`${name} must contain between 1 and 32 comma-separated IP addresses or CIDR ranges.`);
  }
  const unique = new Set<string>();
  for (const entry of entries) {
    const parts = entry.split("/");
    if (parts.length > 2) throw new RangeError(`${name} contains an invalid CIDR range.`);
    const address = parts[0] ?? "";
    const family = isIP(address);
    if (family === 0) throw new RangeError(`${name} contains an invalid IP address.`);
    if (parts.length === 2) {
      const prefix = parts[1] ?? "";
      const maximum = family === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefix) || Number(prefix) > maximum) {
        throw new RangeError(`${name} contains an invalid CIDR prefix.`);
      }
      if (Number(prefix) === 0) {
        throw new RangeError(`${name} must not trust every network address.`);
      }
    }
    unique.add(entry);
  }
  return [...unique];
}

function optionalTrustedProxyHops(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-4]$/.test(value)) {
    throw new RangeError(`${name} must be an integer between 1 and 4.`);
  }
  return Number(value);
}

function optionalRateLimitClientIpSource(
  name: string,
  value: string | undefined,
): PublicAppRuntimeOptions["rateLimitClientIpSource"] {
  if (value === undefined) return "express";
  if (value !== "render-cf-connecting-ip") {
    throw new RangeError(`${name} must be render-cf-connecting-ip when configured.`);
  }
  return value;
}

function validateRenderClientIpSource(
  environment: Environment,
  widgetDomain: string | undefined,
  trustedProxyCidrs: readonly string[],
  trustedProxyHops: number | undefined,
): void {
  if (trustedProxyCidrs.length > 0 || trustedProxyHops !== undefined) {
    throw new RangeError("RATE_LIMIT_CLIENT_IP_SOURCE must not be combined with Express proxy trust.");
  }
  if (environment.RENDER !== "true" || environment.RENDER_SERVICE_TYPE !== "web") {
    throw new RangeError("render-cf-connecting-ip requires a Render web service.");
  }
  if (widgetDomain === undefined || environment.RENDER_EXTERNAL_URL !== widgetDomain) {
    throw new RangeError("render-cf-connecting-ip requires PUBLIC_BASE_URL to match RENDER_EXTERNAL_URL.");
  }
  const hostname = new URL(widgetDomain).hostname;
  if (hostname !== environment.RENDER_EXTERNAL_HOSTNAME || !hostname.endsWith(".onrender.com")) {
    throw new RangeError("render-cf-connecting-ip requires the exact Render onrender.com hostname.");
  }
}
