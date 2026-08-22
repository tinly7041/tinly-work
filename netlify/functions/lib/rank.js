import { SOURCE_WEIGHT, SOURCE_SIGNAL, CACHE_TARGET } from "./categories.js";

// ---------- normalize ----------
const STRIP = /^(the|a|an|show hn|ask hn)\s+/i;

export function canonUrl(u = "") {
  try {
    const x = new URL(u);
    x.hash = "";
    [...x.searchParams.keys()].forEach((k) => {
      if (/^(utm_|ref|source|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
    });
    x.hostname = x.hostname.replace(/^www\./, "");
    x.pathname = x.pathname.replace(/\/+$/, "");
    return x.toString().toLowerCase();
  } catch {
    return (u || "").toLowerCase();
  }
}

const tokens = (t = "") =>
  new Set(t.toLowerCase().replace(STRIP, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / (a.size + b.size - hit);
}

// ---------- score ----------
// DECISION: score is rank-percentile WITHIN a source, never the raw value.
// 27,000 GitHub stars and 300 HN points are not comparable numbers. Percentile is.
// Verified live: the top Web3 GitHub repo had 1,153 stars while the top AI repo had
// 107,048. Any absolute floor would have deleted Web3 entirely.
// TASK 5 FIX — proposed and applied: add-one (Laplace) rank smoothing.
// Old formula (idx / (n-1)) put the bottom item of ANY source at a literal
// 0.000 and the top at a literal 1.000 whenever n>1. At small n that's not
// "the weaker of two items," it reads as "worth nothing" — observed live:
// [0.000] producthunt — MeetStream AI, from a source with only 2 items —
// and round-robin then serves it into the top 40 anyway, since rank() only
// orders within a source bucket and doesn't know the score is degenerate.
// (idx+1)/(n+1) keeps every percentile in the open interval (0,1), preserves
// the exact same relative ordering, and converges to the old formula as n
// grows (they differ by O(1/n)). n=1 now yields 0.5 (neutral) instead of a
// forced 1.0 — a lone item from a thin source shouldn't auto-rank as that
// source's best just because it's the only one.
// Alternatives considered and rejected: a hard floor constant (arbitrary,
// doesn't scale with n) and dropping small-n sources outright (destroys real
// data instead of just declining to zero it out).
function percentileBySource(items) {
  const groups = {};
  for (const i of items) (groups[i.source] ||= []).push(i);
  for (const list of Object.values(groups)) {
    const sorted = [...list].sort((a, b) => (a.raw || 0) - (b.raw || 0));
    const n = sorted.length;
    sorted.forEach((it, idx) => { it._pct = (idx + 1) / (n + 1); });
  }
  return items;
}

// Half-life 5 days. Long enough that a strong Monday item survives to Friday,
// short enough that a 3-week-old repo does not sit in the cache forever.
function recency(dateStr) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (Date.now() - t) / 864e5);
  return Math.pow(0.5, days / 5);
}

export function score(items, cfg = {}) {
  percentileBySource(items);
  for (const i of items) {
    const w = cfg.weightOverride?.[i.source] ?? SOURCE_WEIGHT[i.source] ?? 0.5;
    i.score = Number((i._pct * w * (0.4 + 0.6 * recency(i.date))).toFixed(4));
    i.signal = SOURCE_SIGNAL[i.source] ?? "category";
    delete i._pct;
  }
  return items;
}

// ---------- dedupe ----------
// TASK 4 — cross-source corroboration is now recorded, not just counted and
// thrown away. Merging two items keeps the higher-scored one as canonical but
// unions their `corroborated_sources` so the signal survives; a canonical
// item's own source is included so `corroborated_sources.length` is always a
// true source count (1 = uncorroborated).
function mergeCorroboration(a, b) {
  const sources = new Set([...(a.corroborated_sources || [a.source]), ...(b.corroborated_sources || [b.source])]);
  return [...sources];
}

export function dedupe(items) {
  const byUrl = new Map();
  let removed = 0;
  for (const i of items) {
    const k = canonUrl(i.url);
    const prev = byUrl.get(k);
    if (!prev) byUrl.set(k, i);
    else {
      removed++;
      const winner = (i.score || 0) > (prev.score || 0) ? i : prev;
      byUrl.set(k, { ...winner, corroborated_sources: mergeCorroboration(i, prev) });
    }
  }
  const kept = [];
  for (const i of byUrl.values()) {
    const tk = tokens(i.title);
    const dupIdx = kept.findIndex((k) => jaccard(tokens(k.title), tk) >= 0.8);
    if (dupIdx === -1) kept.push(i);
    else {
      removed++;
      const dup = kept[dupIdx];
      const winner = (i.score || 0) > (dup.score || 0) ? i : dup;
      kept[dupIdx] = { ...winner, corroborated_sources: mergeCorroboration(i, dup) };
    }
  }
  return { items: kept, removed };
}

// Boost applied AFTER dedupe, once corroboration is known. Modest and
// additive (+0.05 per extra corroborating source, capped at 1.0) rather than
// multiplicative, so one lucky duplicate can't catapult an otherwise-weak
// item to the top on corroboration alone — it nudges rank, it doesn't decide it.
export function applyCorroborationBoost(items) {
  for (const i of items) {
    const n = i.corroborated_sources?.length ?? 1;
    if (n > 1) i.score = Number(Math.min(1, (i.score || 0) + 0.05 * (n - 1)).toFixed(4));
  }
  return items;
}

// ---------- rank ----------
// DECISION: round-robin by source before falling back to pure score.
// A flat score sort lets one source own the whole cache. The Phase 2.5 action
// standard needs >=2 unique sources in the served 5, and >=3 as a cache health
// check — that has to be guaranteed here, in the 40, not hoped for downstream.
export function rank(items, limit = CACHE_TARGET) {
  const buckets = {};
  for (const i of items) (buckets[i.source] ||= []).push(i);
  for (const b of Object.values(buckets)) b.sort((a, z) => z.score - a.score);
  const names = Object.keys(buckets).sort((a, z) => (SOURCE_WEIGHT[z] ?? 0) - (SOURCE_WEIGHT[a] ?? 0));
  const out = [];
  let round = 0;
  while (out.length < limit) {
    let added = 0;
    for (const n of names) {
      const it = buckets[n][round];
      if (it) { out.push(it); added++; }
      if (out.length >= limit) break;
    }
    if (!added) break;
    round++;
  }
  return out;
}

// ---------- health ----------
// This is the honest read on cache quality. It is what tells you a category is
// quiet BEFORE Sonnet has to fake five items out of it.
export function health(items, removed) {
  const perSource = {};
  for (const i of items) perSource[i.source] = (perSource[i.source] || 0) + 1;
  const ages = items.map((i) => (Date.now() - Date.parse(i.date)) / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  const corroborated = items.filter((i) => (i.corroborated_sources?.length ?? 1) > 1).length;
  return {
    total: items.length,
    per_source: perSource,
    unique_sources: Object.keys(perSource).length,
    dupes_removed: removed,
    corroborated_items: corroborated, // Task 4: items confirmed by 2+ sources
    median_age_days: ages.length ? Number(ages[Math.floor(ages.length / 2)].toFixed(1)) : null,
    // gate: below this, the category is quiet. Route to the "I'll email you when
    // it moves" path rather than letting Sonnet pad.
    healthy: items.length >= 20 && Object.keys(perSource).length >= 3,
  };
}

export function pipeline(rawItems, limit = CACHE_TARGET, cfg = {}) {
  score(rawItems, cfg);
  const { items, removed } = dedupe(rawItems);
  applyCorroborationBoost(items);
  const ranked = rank(items, limit);
  return { items: ranked, health: health(ranked, removed) };
}
