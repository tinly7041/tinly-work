import { getStore } from "@netlify/blobs";
import { ACTIVE } from "./lib/categories.js";
import { collect } from "./lib/collect.js";

// Daily scheduled crawl. This is the ONLY place a source is ever called.
// The user request path (get-trends.js) reads Blobs and nothing else.
export default async () => {
  const store = getStore("trends");
  const report = [];
  for (const cat of ACTIVE) {
    try {
      const result = await collect(cat);
      await store.setJSON(cat, { fetched_at: new Date().toISOString(), ...result });
      report.push({ cat, ...result.health });
      console.log(`[crawl] ${cat}`, JSON.stringify(result.health));
    } catch (e) {
      // Do NOT overwrite the existing blob on failure. Yesterday's cache beats
      // an empty one — the read path must always have something to serve.
      console.error(`[crawl] ${cat} FAILED, keeping previous blob — ${e.message}`);
      report.push({ cat, error: e.message });
    }
  }
  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), report }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "@daily" };
