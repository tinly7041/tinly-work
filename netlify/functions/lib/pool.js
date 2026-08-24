// netlify/functions/lib/pool.js
//
// One code path for loading a category's trend pool, whichever backing store
// it's actually in. Local dev (scripts/seed-cache.js, scripts/generate-report.js)
// writes to .cache/trends-<category>.json; production writes the same shape to
// Netlify Blobs (crawl-trends.js). This reads the local file when it exists
// and falls back to Blobs otherwise — chosen by file presence, not by an env
// flag, so the same code runs in both places without branching on NODE_ENV.
//
// No source call ever happens here — this is a pure read of whichever cache
// already exists. If neither exists, the category has no pool, full stop.

import { readFile } from "fs/promises";
import path from "path";

const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const STORE_NAME = process.env.BLOBS_STORE_NAME || "trends";

function cachePath(cat) {
  return path.join(CACHE_DIR, `trends-${cat}.json`);
}

export async function loadCategoryPool(catKey, { getStore } = {}) {
  try {
    const raw = await readFile(cachePath(catKey), "utf8");
    return { ...JSON.parse(raw), _source: "file" };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const getStoreImpl = getStore || (await import("@netlify/blobs")).getStore;
  const store = getStoreImpl(STORE_NAME);
  const blob = await store.get(catKey, { type: "json" });
  if (!blob) return null;
  return { ...blob, _source: "blobs" };
}
