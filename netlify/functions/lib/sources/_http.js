// The bare "tinly-work-trendpulse/0.1" UA got 403'd by at least one
// news-feeds outlet (Tech in Asia) that some of the older per-source APIs
// never hit — live-verified 24 Aug that prefixing a standard browser-style
// token fixes it, no functional change otherwise (still self-identifies via
// the trailing token + URL). A couple of Cloudflare-fronted outlets
// (Crowdfund Insider, e27) 403 regardless of UA string — that's TLS/client
// fingerprinting, not fixable from a header alone; sources/news-feeds.js's
// per-feed safe() already makes that a harmless no-op rather than a crawl
// failure.
const USER_AGENT = "Mozilla/5.0 (compatible; tinly-work-trendpulse/0.1; +https://tinly.work)";

export async function get(url, { headers = {}, timeout = 8000, json = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": USER_AGENT, ...headers },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return json ? await r.json() : await r.text();
  } finally {
    clearTimeout(t);
  }
}

// Every adapter fails soft and returns []. One dead source must never
// take down the daily crawl for a whole category.
//
// _failures: a side-channel so the trial log (Step 4) can report REAL
// per-source failures instead of leaving "failures" null. Not specified in
// the brief — proposed here rather than picked silently. Reset per category
// by the caller (crawl-trends.js), read right after that category's
// collect() resolves. Does not change safe()'s return behavior at all.
export const _failures = [];
export function _resetFailures() {
  _failures.length = 0;
}
export async function safe(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[source:${name}] failed — ${e.message}`);
    _failures.push({ source: name, error: e.message });
    return [];
  }
}
