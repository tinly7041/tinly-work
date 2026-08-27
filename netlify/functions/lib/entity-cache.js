// netlify/functions/lib/entity-cache.js
//
// Phase 2.7 — shared competitor-entity cache. Keyed by normalized entity
// name (not by brand or lead), so two different brands naming the same
// competitor within the TTL window share one fetch — "Uniswap" and some
// other DEX both naming "Aerodrome" as a competitor read the same cached
// entry, no refetch. 7-day TTL, checked on read: an entry older than that
// is treated as absent (the caller — lib/competitor-fetch.js — decides
// whether to refetch; this module only knows freshness, never fetches
// itself).
//
// Same file-then-Blobs pattern as pool.js: local dev reads/writes
// .cache/entity-<name>.json when present, production reads/writes Netlify
// Blobs. Chosen by file presence, not NODE_ENV, so the same code runs in
// both places.
//
// NO SOURCE CALL HAPPENS HERE. This is a pure cache read/write, same
// boundary pool.js draws for category pools.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export const ENTITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STORE_NAME = process.env.BLOBS_STORE_NAME || "trends";
const ENTITY_STORE = "competitor-entities";
const CACHE_DIR = path.resolve(process.cwd(), ".cache", "entities");

export function normalizeEntityName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cachePath(key) {
  // Entity names can contain characters unsafe in filenames (/, quotes) —
  // encode rather than sanitize-and-hope, so no two distinct entities can
  // ever collide onto the same local cache file.
  return path.join(CACHE_DIR, `${encodeURIComponent(key)}.json`);
}

function isFresh(entry, ttlMs = ENTITY_CACHE_TTL_MS) {
  if (!entry?.fetched_at) return false;
  const age = Date.now() - Date.parse(entry.fetched_at);
  return Number.isFinite(age) && age <= ttlMs;
}

// Returns the cached entry only if present AND fresh; stale or missing both
// return null — the caller can't tell the difference and shouldn't need to
// (either way, there's nothing usable to read right now).
export async function getCachedEntity(entityName, { getStore, ttlMs = ENTITY_CACHE_TTL_MS } = {}) {
  const key = normalizeEntityName(entityName);
  if (!key) return null;

  let entry = null;
  try {
    const raw = await readFile(cachePath(key), "utf8");
    entry = JSON.parse(raw);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const getStoreImpl = getStore || (await import("@netlify/blobs")).getStore;
    const store = getStoreImpl(ENTITY_STORE);
    entry = await store.get(key, { type: "json" });
  }

  return isFresh(entry, ttlMs) ? entry : null;
}

export async function setCachedEntity(entityName, data, { getStore } = {}) {
  const key = normalizeEntityName(entityName);
  if (!key) throw new Error("entityName is required");
  const entry = { ...data, entity: entityName, fetched_at: new Date().toISOString() };

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(key), JSON.stringify(entry, null, 2));
    return entry;
  } catch {
    // Local file write failed (e.g. read-only/serverless filesystem) — fall
    // through to Blobs, same fallback direction as pool.js's read path.
  }

  const getStoreImpl = getStore || (await import("@netlify/blobs")).getStore;
  const store = getStoreImpl(ENTITY_STORE);
  await store.setJSON(key, entry);
  return entry;
}
