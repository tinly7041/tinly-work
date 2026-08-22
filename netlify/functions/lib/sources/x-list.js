import { safe } from "./_http.js";

const LIST_ID = "2091104892089946244";
const API = `https://api.twitter.com/2/lists/${LIST_ID}/tweets`;

// STRUCTURAL NOTE (per Task 2 brief): the List is ONE curated timeline, not
// per-category — unlike every other source here, there is no per-category
// query to run. Naively calling this once per active category would refetch
// the identical list up to 4x per crawl, quadrupling the billed post-reads
// for zero new data. Instead the list is fetched ONCE per crawl process and
// memoized; each category's collect() call reuses the cached tweets and only
// runs its own keyword classification over them locally (free).
//
// BUDGET DECISION (documented per instruction, not picked silently): the
// brief states "10 posts per category per day" for a source that isn't
// callable per category. Read as a total daily post-read budget across the
// single fetch: 10 * 4 active categories = 40 posts/day = 40 * $0.005 = $0.20/day.
// max_results below is set to 40 to match. If the intent was instead "~10
// surviving per category AFTER classification," this undercounts — flag it,
// don't silently raise the fetch size to compensate for a filter that drops
// posts, since that would blow the stated budget without being asked.
const MAX_RESULTS = 40;

// CATEGORY ASSIGNMENT (documented per instruction): keyword match against
// each category's own `hn` + `productHunt` keyword arrays from categories.js
// (github's config is a boolean-query string, not a plain keyword list, so
// it's not reused here). A tweet can match more than one category — kept in
// both, since corroboration across categories isn't the same claim as
// corroboration across sources. A tweet matching NO category's keywords is
// dropped entirely, never defaulted into a catch-all.
function buildKeywords(cfg) {
  return [...(cfg.hn || []), ...(cfg.productHunt || [])].map((k) => k.toLowerCase());
}

let _listCache = null;
// Billing visibility: how many posts were actually pulled from the ONE
// underlying fetch this process made (that's the real $-cost), independent
// of how many categories later reuse the cache or how many posts survive
// each category's keyword filter.
const _billing = { attempted: false, fetched: false, rawCount: 0, lastError: null };

function fetchListOnce() {
  if (!_listCache) {
    _billing.attempted = true;
    _listCache = safe("xlist", async () => {
      const url = `${API}?max_results=${MAX_RESULTS}&tweet.fields=created_at,public_metrics`;
      const headers = { Authorization: `Bearer ${process.env.X_BEARER_TOKEN || ""}` };
      const res = await fetch(url, { headers });
      if (!res.ok) {
        // Rejections (bad auth/entitlement/etc) return before any post data
        // is returned, so they're not billed — capture the body for
        // diagnosis rather than the generic "HTTP 403" _http.js's get()
        // would give.
        const body = await res.text();
        _billing.lastError = { status: res.status, body: body.slice(0, 500) };
        throw new Error(`HTTP ${res.status} ${url} — ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const tweets = json.data || [];
      _billing.fetched = true;
      _billing.rawCount = tweets.length;
      return tweets;
    });
  }
  return _listCache;
}

export function getXListBilling() {
  return { ..._billing, estimatedSpendUSD: Number((_billing.rawCount * 0.005).toFixed(3)) };
}

// Exposed for tests/probes that need to force a fresh fetch across runs in
// the same process (production always runs one crawl per process, so this
// never matters there).
export function _resetXListCache() {
  _listCache = null;
  _billing.fetched = false;
  _billing.rawCount = 0;
}

export async function fetchXList(cfg, catKey) {
  if (!cfg.xList) return [];
  if (!process.env.X_BEARER_TOKEN) return [];

  const tweets = await fetchListOnce();
  const keywords = buildKeywords(cfg);
  if (!keywords.length) return [];

  return tweets
    .filter((t) => {
      const text = (t.text || "").toLowerCase();
      return keywords.some((k) => text.includes(k));
    })
    .map((t) => {
      const metrics = t.public_metrics || {};
      const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0);
      return {
        title: (t.text || "").replace(/\s+/g, " ").trim(),
        // Generic-username permalink form — resolving the real handle needs a
        // User expansion, which is a separately billed read ($0.010) the
        // brief explicitly says to skip. This form redirects correctly by ID
        // alone without it.
        url: `https://x.com/i/web/status/${t.id}`,
        source: "xlist",
        raw: engagement,
        date: t.created_at,
        _category: catKey,
      };
    });
}
