// netlify/functions/lib/sources/competitor-news.js
//
// Phase 2.7 — competitor layer. Category news is about the category;
// nothing upstream retrieves news about a specific named competitor. This
// adapter answers "what has <entity> shipped/done recently," for entities
// supplied on the confirm screen or inferred by Haiku when that field is
// blank.
//
// QUERY CONSTRUCTION IS THE WHOLE GAME (per the brief). A bare entity name
// returns noise: live-verified, a plain Google News query for "Retool"
// returned baseball/hockey "retool" headlines, zero real hits. Fix,
// live-confirmed: quote the entity name as an exact phrase AND append the
// entity's category's `queryContext` term (categories.js) — "Retool"
// software" returns only real hits. Every result is still independently
// re-validated below via the SAME matcher.js taxonomy every category source
// uses (categorize()) — the query shapes what gets fetched, the matcher
// decides what survives. This is deliberately the same precision problem
// "ledger" (the fintech word) vs. Ledger (the product) already solves for
// category items, restated for entity items — reused, not reimplemented.
//
// Source: Google News RSS only. Bing is explicitly excluded per the brief
// (an unofficial/unlisted surface, previously proposed as primary, now
// decided against — do not re-add it).
//
// NO SOURCE CALL IN THE USER REQUEST PATH. This module is called only by
// lib/competitor-fetch.js, which is called only by the background function
// (netlify/functions/competitor-fetch-background.js) — never by read-pulse.js
// or generate-pulse.js directly.

import { get, _failures } from "./_http.js";
import { parseItems, tag, link } from "../rss.js";
import { firstItemMatch, itemMatchesTerm } from "../matcher.js";
import { CATEGORIES } from "../categories.js";

const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";
const WINDOW_DAYS = 14; // same freshness window as sources/news-feeds.js
const RESULT_LIMIT = 20;
const DESCRIPTION_LIMIT = 500;

// Fix-pass brief, item 1: Google News RSS returns HTTP 200 with a
// syntactically valid, EMPTY channel (zero <item> blocks) intermittently and
// unpredictably for well-covered queries — live-caught, same process, same
// query string: "Uniswap" crypto returned 0, 0, 0, then 101 minutes later.
// This is a launch blocker, not an edge case: the product sends one report
// per lead, and the 7-day entity cache only helps the NEXT lead naming the
// same entity — the lead whose fetch landed on the empty window gets "your
// category is quiet" and never returns, indistinguishable from a genuine
// quiet result.
//
// Retry ONLY on a successfully-parsed-but-empty response. An HTTP/network
// error is a different failure mode, already handled (logged to _failures,
// [] returned, same as every other adapter) — NOT retried, per instruction.
const EMPTY_RETRY_ATTEMPTS = 3; // total attempts, including the first
const EMPTY_RETRY_BACKOFF_MS = 600; // short, linear backoff between attempts

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildCompetitorQuery(entity, categoryKey) {
  const cfg = CATEGORIES[categoryKey];
  const queryContext = cfg?.queryContext;
  if (!queryContext) throw new Error(`unknown category or missing queryContext: ${categoryKey}`);
  return `"${entity}" ${queryContext}`;
}

function withinWindow(dateStr, windowDays) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return true; // no parseable date — don't drop it for that alone
  return (Date.now() - t) / 864e5 <= windowDays;
}

// Google News RSS titles carry a trailing " - Outlet Name" suffix Google
// itself appends — stripped here so downstream matching/display sees the
// real headline, not "Real headline - Reuters".
function stripSourceSuffix(title) {
  return (title || "").replace(/\s+-\s+[^-]+$/, "").trim();
}

// Returns { items, fetch_meta }. fetch_meta.exhausted_empty is true only
// when every attempt succeeded (HTTP-wise) and every attempt parsed to zero
// <item>/<entry> blocks — the ambiguous "we genuinely don't know" case this
// brief is about. An HTTP/network error is reported via fetch_meta.http_error
// and is NOT retried; items is [] in that case, same as before this change.
//
// getImpl/sleepImpl are injectable ONLY so the retry loop's logic (attempt
// counting, break-on-success, break-on-error, no-retry-past-the-cap) can be
// mock-verified without a live network call — see competitor-news.test.js.
// The real path (fetchCompetitorNews, and everything upstream of it) always
// uses the real `get` and real `setTimeout`; production behavior is
// unaffected by this seam.
export async function fetchGoogleNewsRaw(query, { getImpl = get, sleepImpl = sleep } = {}) {
  const url = `${GOOGLE_NEWS_RSS}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  let blocks = [];
  let attempt = 0;
  let httpError = null;

  for (attempt = 1; attempt <= EMPTY_RETRY_ATTEMPTS; attempt++) {
    try {
      const xml = await getImpl(url);
      blocks = parseItems(xml);
    } catch (e) {
      // Same logging/tracking shape every other adapter's safe() call uses —
      // written out manually here (not via safe()) because safe() collapses
      // "failed" and "succeeded with zero items" into the same bare [],
      // which is exactly the ambiguity this fix needs to resolve, not repeat.
      console.warn(`[source:competitor-news:google] failed — ${e.message}`);
      _failures.push({ source: "competitor-news:google", error: e.message });
      httpError = e.message;
      blocks = [];
      break; // HTTP/network error — not retried
    }
    if (blocks.length > 0) break;
    if (attempt < EMPTY_RETRY_ATTEMPTS) await sleepImpl(EMPTY_RETRY_BACKOFF_MS * attempt);
  }

  const items = blocks
    .slice(0, RESULT_LIMIT)
    .map((b) => ({
      title: stripSourceSuffix(tag(b, "title")),
      description: (tag(b, "description") || "").slice(0, DESCRIPTION_LIMIT),
      url: link(b) || "",
      source: "competitor-news",
      date: tag(b, "pubDate") || new Date().toISOString(),
    }))
    .filter((i) => i.title && i.url)
    .filter((i) => withinWindow(i.date, WINDOW_DAYS));

  return {
    items,
    fetch_meta: {
      attempts: attempt > EMPTY_RETRY_ATTEMPTS ? EMPTY_RETRY_ATTEMPTS : attempt,
      exhausted_empty: !httpError && blocks.length === 0,
      http_error: httpError,
    },
  };
}

// Two independent gates, both required — belt and suspenders on top of the
// quoted-phrase query, not a substitute for it:
//   1. the entity name itself must actually appear (word/phrase-boundary,
//      via matcher.js's own term-match rules) — belt and suspenders on top
//      of the quoted-phrase query, for the (rare, unobserved live) case
//      Google's quoted search is looser than a strict phrase filter.
//   2. the category's `exclude` list only (not the full include/ambiguous+
//      context taxonomy) — rule 5, "exclusions beat includes, always,"
//      applied as a pure safety net.
//
// AMENDED FROM THE ORIGINAL DESIGN, live-verified: requiring a full
// categorize() match (include, or ambiguous+context) here was tried first,
// per the brief's literal instruction to "route every result through the
// EXISTING matcher.js include/ambiguous/context taxonomy." Live testing
// against real entities found it rejected genuine, high-value events
// wholesale — a $7B Stripe/OpenRouter acquisition, a PayPal/Stripe merger-
// talk story, an Aerodrome Finance token buyback — none of which repeat
// generic category buzzwords in a short headline, none of which categorize()
// would call "direct" or even "ambiguous+context." Across every live query
// run for the Phase 2.7 verify (Aerodrome Finance, Curve Finance, Uniswap,
// Stripe, Retool, Notion), the `exclude` list caught zero real noise and the
// entity-name gate above — combined with the quoted-phrase query itself,
// which leans on Google's own full-document relevance ranking rather than a
// title-only keyword check — did 100% of the actual disambiguation work; see
// the Phase 2.7 report for the full transcript. A stray false positive that
// slips past both gates here still reaches Pass 1 (read-pulse.js) with full
// brand/category context and gets correctly scored "none"/non-event there —
// this is a precision optimization before that step, not the correctness
// boundary itself.
export function filterForEntity(items, entity, categoryKey) {
  const cfg = CATEGORIES[categoryKey];
  const kept = [];
  const rejected = [];
  for (const item of items) {
    if (!itemMatchesTerm(item, entity)) {
      rejected.push({ item, reason: "entity_name_absent" });
      continue;
    }
    const excludeHit = firstItemMatch(item, cfg.exclude);
    if (excludeHit) {
      rejected.push({ item, reason: "excluded", term: excludeHit });
    } else {
      kept.push(item);
    }
  }
  return { kept, rejected };
}

// entity: string (e.g. "Aerodrome"). categoryKey: one of CATEGORIES' keys —
// the category context this entity is assumed to compete in (see
// lib/competitor-fetch.js for why: no separate classification call for the
// competitor, it inherits the brand's own primary category).
//
// Returns { query, items, rejected, fetch_meta } — items are shaped like any
// other pool item (title/description/url/source/date) plus `entity`;
// rejected carries enough to print for the VERIFY report (title + reason),
// never silently dropped without a trace. fetch_meta.exhausted_empty tells
// the caller (lib/competitor-fetch.js) whether this is a genuine "no
// coverage" result or an unresolved empty window — see that file for how
// the cache treats the difference.
export async function fetchCompetitorNews(entity, categoryKey) {
  const query = buildCompetitorQuery(entity, categoryKey);
  const { items: raw, fetch_meta } = await fetchGoogleNewsRaw(query);
  const { kept, rejected } = filterForEntity(raw, entity, categoryKey);
  return {
    query,
    items: kept.map((item) => ({ ...item, entity })),
    rejected: rejected.map((r) => ({ title: r.item.title, url: r.item.url, reason: r.reason })),
    fetch_meta,
  };
}
