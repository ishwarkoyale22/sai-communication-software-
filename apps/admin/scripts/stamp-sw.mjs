// Runs after `vite build` (see package.json's "build" script). Gives dist/sw.js a fresh, unique
// CACHE_NAME on every single build, so its bytes always differ from the previously deployed version —
// see the comment above CACHE_NAME in public/sw.js for why that matters.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const swPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const original = readFileSync(swPath, "utf8");
if (!original.includes("__BUILD_ID__")) {
  throw new Error("stamp-sw.mjs: __BUILD_ID__ placeholder not found in dist/sw.js — did public/sw.js change?");
}
writeFileSync(swPath, original.replaceAll("__BUILD_ID__", buildId));
console.log(`[stamp-sw] dist/sw.js cache name stamped: sai-admin-shell-${buildId}`);
