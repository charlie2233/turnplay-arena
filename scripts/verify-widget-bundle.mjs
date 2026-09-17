#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CURRENT_WIDGET_BUNDLE_SHA256,
  CURRENT_WIDGET_RELEASE_MARKER,
} from "./production-acceptance.mjs";

const widgetPath = resolve(process.cwd(), "web", "dist", "index.html");
let html;
try {
  html = await readFile(widgetPath, "utf8");
} catch {
  console.error("Widget bundle verification failed: web/dist/index.html is missing. Build the web workspace first.");
  process.exitCode = 1;
}

if (html !== undefined) {
  const digest = createHash("sha256").update(html, "utf8").digest("hex");
  if (!html.includes(CURRENT_WIDGET_RELEASE_MARKER) || digest !== CURRENT_WIDGET_BUNDLE_SHA256) {
    console.error("Widget bundle verification failed: the v22 release marker or reviewed SHA-256 digest changed. Bump the immutable widget resource and review the new bundle before updating the pin.");
    process.exitCode = 1;
  } else {
    console.log(`Verified reviewed v22 widget bundle (${digest.slice(0, 12)}…).`);
  }
}
