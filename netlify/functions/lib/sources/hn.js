import { get, safe } from "./_http.js";
import { categorize } from "../matcher.js";

const API = "https://hn.algolia.com/api/v1/search_by_date";

// BUILD NOTE (category-gates rework, revised after a live test). The old
// design used cfg.hn — five short per-category search phrases sent straight
// to Algolia's `/search` — as BOTH the discovery query AND the relevance
// decision: anything Algolia returned that also cleared points>20 was kept
// outright. That is exactly the "popularity backfill" the brief says to
// remove — an item that only ever matched a single loose search term (e.g.
// "ledger") and had enough points shipped as FinTech with zero further
// check.
//
// The first version of this rewrite tried keeping per-category Algolia
// queries (seeded from categories.js's own `include` list, to avoid a
// second parallel keyword surface) as a discovery step, gated by a mandatory
// categorize() check on every candidate. Live-tested against Web3's include
// list and it returned ZERO matches — not because Web3 was quiet, but
// because Algolia's `/search` endpoint is typo-tolerant free-text search,
// not literal substring matching: query=DEX returned "DeepSeek V4 Pro",
// "Deutsche Bank becomes first foreign yuan clearing bank", "Delta" — none
// containing the literal word "DEX". categorize() correctly rejected every
// one of them (it is not the bug), but that also meant the seed-query
// approach could never surface a genuine candidate reliably: Algolia's own
// fuzzy relevance ranking, not the shared matcher, was deciding what even
// became a candidate.
//
// Fixed design: no query at all. Fetch every HN story above the points
// floor in the window (search_by_date, tags=story, no `query` param — pure
// numeric/date filtering, no fuzzy text ranking involved) ONCE per crawl
// process, paginated, and memoize it exactly like sources/x-list.js does
// for its one list fetch — every category reuses the same pool and runs its
// own categorize() over it locally, for free. Live-verified 24 Aug: 1,254
// stories/14 days at points>20 (10 pages of 100) — a fixed, small, one-time
// cost regardless of how many categories are active, and now the ONLY thing
// deciding category membership is the shared matcher, exactly as the brief
// requires ("must match include, or ambiguous + context. No exceptions").
const WINDOW_DAYS = 14;
const POINTS_FLOOR = 20;
const PAGE_SIZE = 100;
const MAX_PAGES = 12; // headroom above the live-verified 10 pages/1,254 stories

let _poolCache = null;

function fetchPoolOnce() {
  if (!_poolCache) {
    _poolCache = safe("hn", async () => {
      const since = Math.floor((Date.now() - WINDOW_DAYS * 864e5) / 1000);
      const all = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const u = `${API}?tags=story`
          + `&numericFilters=created_at_i>${since},points>${POINTS_FLOOR}`
          + `&hitsPerPage=${PAGE_SIZE}&page=${page}`;
        const j = await get(u, { json: true });
        const hits = j.hits || [];
        all.push(...hits);
        if (hits.length < PAGE_SIZE) break; // exhausted
      }
      return all
        .map((h) => ({
          title: h.title,
          description: "",
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          source: "hn",
          raw: h.points || 0,
          date: h.created_at,
        }))
        .filter((it) => it.title);
    });
  }
  return _poolCache;
}

// Exposed for tests/probes that need a fresh fetch across runs in the same
// process — mirrors x-list.js's _resetXListCache. Production runs one crawl
// per process, so this never matters there.
export function _resetHNCache() {
  _poolCache = null;
}

export async function fetchHN(cfg) {
  const pool = await fetchPoolOnce();
  // The points floor above is already a quality filter applied at fetch
  // time to items independent of relevance. The real gate is here: every
  // item, regardless of how popular it is, must independently match the
  // category's taxonomy. No exceptions, no fallback if this yields too few.
  return pool.filter((it) => categorize(it, cfg).matched);
}
