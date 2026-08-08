import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAME_STORE_MAX_SESSIONS,
  DEFAULT_GAME_STORE_TTL_MS,
  DEFAULT_LEGACY_BACKUP_TTL_MS,
  MAX_GAME_STORE_SESSIONS,
} from "../src/game-store.js";
import {
  gameStoreRuntimeOptionsFromEnvironment,
  publicAppRuntimeOptionsFromEnvironment,
} from "../src/runtime-config.js";

describe("game store runtime configuration", () => {
  it("uses the documented safe defaults when variables are absent", () => {
    expect(gameStoreRuntimeOptionsFromEnvironment({})).toEqual({
      ttlMs: DEFAULT_GAME_STORE_TTL_MS,
      maxSessions: DEFAULT_GAME_STORE_MAX_SESSIONS,
      legacyBackupTtlMs: DEFAULT_LEGACY_BACKUP_TTL_MS,
    });
  });

  it("accepts positive bounded integer overrides", () => {
    expect(gameStoreRuntimeOptionsFromEnvironment({
      GAME_STORE_TTL_MS: "604800000",
      GAME_STORE_MAX_SESSIONS: "2500",
      GAME_STORE_LEGACY_BACKUP_TTL_MS: "86400000",
    })).toEqual({ ttlMs: 604_800_000, maxSessions: 2_500, legacyBackupTtlMs: 86_400_000 });
  });

  it.each(["", "0", "-1", "1.5", " 1000", "1000 ", "1e3", "9007199254740992"])(
    "rejects invalid GAME_STORE_TTL_MS value %j",
    (value) => {
      expect(() => gameStoreRuntimeOptionsFromEnvironment({ GAME_STORE_TTL_MS: value }))
        .toThrow(/GAME_STORE_TTL_MS/);
    },
  );

  it.each(["", "0", "-1", "1.5", " 1000", "1000 ", "1e3", String(MAX_GAME_STORE_SESSIONS + 1)])(
    "rejects invalid GAME_STORE_MAX_SESSIONS value %j",
    (value) => {
      expect(() => gameStoreRuntimeOptionsFromEnvironment({ GAME_STORE_MAX_SESSIONS: value }))
        .toThrow(/GAME_STORE_MAX_SESSIONS/);
    },
  );

  it.each(["", "0", "-1", "1.5", " 1000", "1000 ", "1e3", "9007199254740992"])(
    "rejects invalid GAME_STORE_LEGACY_BACKUP_TTL_MS value %j",
    (value) => {
      expect(() => gameStoreRuntimeOptionsFromEnvironment({ GAME_STORE_LEGACY_BACKUP_TTL_MS: value }))
        .toThrow(/GAME_STORE_LEGACY_BACKUP_TTL_MS/);
    },
  );
});

describe("public app runtime configuration", () => {
  it("keeps submission metadata disabled when variables are absent", () => {
    expect(publicAppRuntimeOptionsFromEnvironment({})).toEqual({
      widgetDomain: undefined,
      openAiAppsChallengeToken: undefined,
      trustedProxyCidrs: [],
      trustedProxyHops: undefined,
      rateLimitClientIpSource: "express",
    });
  });

  it("accepts an exact HTTPS widget origin and single-line challenge token", () => {
    expect(publicAppRuntimeOptionsFromEnvironment({
      PUBLIC_BASE_URL: "https://games.example.com/",
      OPENAI_APPS_CHALLENGE_TOKEN: "challenge_token-123",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 2001:db8::/48,10.0.0.0/8",
    })).toEqual({
      widgetDomain: "https://games.example.com",
      openAiAppsChallengeToken: "challenge_token-123",
      trustedProxyCidrs: ["10.0.0.0/8", "2001:db8::/48"],
      trustedProxyHops: undefined,
      rateLimitClientIpSource: "express",
    });
  });

  it.each([
    "",
    "http://games.example.com",
    "https://user@games.example.com",
    "https://games.example.com/path",
    "https://games.example.com/?query=1",
    "https://games.example.com/#fragment",
    "not a url",
  ])("rejects invalid PUBLIC_BASE_URL value %j", (value) => {
    expect(() => publicAppRuntimeOptionsFromEnvironment({ PUBLIC_BASE_URL: value }))
      .toThrow(/PUBLIC_BASE_URL/);
  });

  it("requires an HTTPS public origin and explicit store path in production", () => {
    expect(() => publicAppRuntimeOptionsFromEnvironment({ NODE_ENV: "production" }))
      .toThrow(/PUBLIC_BASE_URL/);
    expect(() => publicAppRuntimeOptionsFromEnvironment({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://games.example.com",
    })).toThrow(/GAME_STORE_PATH/);
    expect(() => publicAppRuntimeOptionsFromEnvironment({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://games.example.com",
      GAME_STORE_PATH: ".data/game-sessions.json",
    })).toThrow(/absolute path/);
    expect(publicAppRuntimeOptionsFromEnvironment({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://games.example.com",
      GAME_STORE_PATH: "/data/game-sessions.json",
    })).toEqual({
      widgetDomain: "https://games.example.com",
      openAiAppsChallengeToken: undefined,
      trustedProxyCidrs: [],
      trustedProxyHops: undefined,
      rateLimitClientIpSource: "express",
    });
  });

  it.each(["", " padded", "padded ", "line\nbreak", "line\rbreak", "x".repeat(2_049)])(
    "rejects invalid OPENAI_APPS_CHALLENGE_TOKEN value",
    (value) => {
      expect(() => publicAppRuntimeOptionsFromEnvironment({ OPENAI_APPS_CHALLENGE_TOKEN: value }))
        .toThrow(/OPENAI_APPS_CHALLENGE_TOKEN/);
    },
  );

  it.each([
    "",
    ",",
    "not-an-ip",
    "10.0.0.1/33",
    "2001:db8::/129",
    "10.0.0.1/24/1",
    "0.0.0.0/0",
    "::/0",
  ])("rejects unsafe TRUSTED_PROXY_CIDRS value %j", (value) => {
    expect(() => publicAppRuntimeOptionsFromEnvironment({ TRUSTED_PROXY_CIDRS: value }))
      .toThrow(/TRUSTED_PROXY_CIDRS/);
  });

  it("accepts a bounded trusted proxy hop count as an alternative to CIDRs", () => {
    expect(publicAppRuntimeOptionsFromEnvironment({ TRUST_PROXY_HOPS: "1" })).toMatchObject({
      trustedProxyCidrs: [],
      trustedProxyHops: 1,
    });
  });

  it.each(["", "0", "5", "01", "1.5", "all"])("rejects unsafe TRUST_PROXY_HOPS value %j", (value) => {
    expect(() => publicAppRuntimeOptionsFromEnvironment({ TRUST_PROXY_HOPS: value }))
      .toThrow(/TRUST_PROXY_HOPS/);
  });

  it("rejects ambiguous proxy trust configuration", () => {
    expect(() => publicAppRuntimeOptionsFromEnvironment({
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
      TRUST_PROXY_HOPS: "1",
    })).toThrow(/must not both/);
  });

  it("accepts Render's overwritten CF client-IP header only for the exact public Render service", () => {
    expect(publicAppRuntimeOptionsFromEnvironment({
      PUBLIC_BASE_URL: "https://turnplay-arena.onrender.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      RENDER: "true",
      RENDER_SERVICE_TYPE: "web",
      RENDER_EXTERNAL_URL: "https://turnplay-arena.onrender.com",
      RENDER_EXTERNAL_HOSTNAME: "turnplay-arena.onrender.com",
    })).toEqual({
      widgetDomain: "https://turnplay-arena.onrender.com",
      openAiAppsChallengeToken: undefined,
      trustedProxyCidrs: [],
      trustedProxyHops: undefined,
      rateLimitClientIpSource: "render-cf-connecting-ip",
    });
  });

  it.each([
    [{ RATE_LIMIT_CLIENT_IP_SOURCE: "cf-connecting-ip" }, /RATE_LIMIT_CLIENT_IP_SOURCE/],
    [{
      PUBLIC_BASE_URL: "https://turnplay-arena.onrender.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      RENDER: "false",
      RENDER_SERVICE_TYPE: "web",
      RENDER_EXTERNAL_URL: "https://turnplay-arena.onrender.com",
      RENDER_EXTERNAL_HOSTNAME: "turnplay-arena.onrender.com",
    }, /Render web service/],
    [{
      PUBLIC_BASE_URL: "https://turnplay-arena.onrender.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      RENDER: "true",
      RENDER_SERVICE_TYPE: "worker",
      RENDER_EXTERNAL_URL: "https://turnplay-arena.onrender.com",
      RENDER_EXTERNAL_HOSTNAME: "turnplay-arena.onrender.com",
    }, /Render web service/],
    [{
      PUBLIC_BASE_URL: "https://turnplay-arena.onrender.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      RENDER: "true",
      RENDER_SERVICE_TYPE: "web",
      RENDER_EXTERNAL_URL: "https://other.onrender.com",
      RENDER_EXTERNAL_HOSTNAME: "turnplay-arena.onrender.com",
    }, /match RENDER_EXTERNAL_URL/],
    [{
      PUBLIC_BASE_URL: "https://games.example.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      RENDER: "true",
      RENDER_SERVICE_TYPE: "web",
      RENDER_EXTERNAL_URL: "https://games.example.com",
      RENDER_EXTERNAL_HOSTNAME: "games.example.com",
    }, /onrender.com hostname/],
    [{
      PUBLIC_BASE_URL: "https://turnplay-arena.onrender.com",
      RATE_LIMIT_CLIENT_IP_SOURCE: "render-cf-connecting-ip",
      TRUST_PROXY_HOPS: "1",
      RENDER: "true",
      RENDER_SERVICE_TYPE: "web",
      RENDER_EXTERNAL_URL: "https://turnplay-arena.onrender.com",
      RENDER_EXTERNAL_HOSTNAME: "turnplay-arena.onrender.com",
    }, /must not be combined/],
  ] as const)("rejects unsafe Render client-IP source configuration %#", (environment, message) => {
    expect(() => publicAppRuntimeOptionsFromEnvironment(environment)).toThrow(message);
  });
});
