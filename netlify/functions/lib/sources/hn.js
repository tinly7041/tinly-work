import { get, safe } from "./_http.js";

const API = "https://hn.algolia.com/api/v1/search";

// Pure. Takes config, returns normalized items. No I/O outside fetch.
export async function fetchHN(cfg, { windowDays = 14, perQuery = 15 } = {}) {
  const since = Math.floor((Date.now() - windowDays * 864e5) / 1000);
  const all = [];
  for (const q of cfg.hn) {
    const items = await safe("hn", async () => {
      const u = `${API}?query=${encodeURIComponent(q)}&tags=story`
        + `&numericFilters=created_at_i>${since},points>20`
        + `&hitsPerPage=${perQuery}`;
      const j = await get(u, { json: true });
      return (j.hits || []).map((h) => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: "hn",
        raw: h.points || 0,
        date: h.created_at,
      }));
    });
    all.push(...items);
  }
  return all.filter((i) => i.title);
}
