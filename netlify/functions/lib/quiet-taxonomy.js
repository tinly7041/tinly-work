// netlify/functions/lib/quiet-taxonomy.js
//
// Pre-gate quiet/thin classification. Pure function, no I/O. The precedence
// order is explicit and sequential — poolThin beats poolStale beats an
// already-passing direct count beats zero competitor signal.
//
// Session 10 (Avis re-run): a pool that already cleared `minDirect` on
// category signal alone (2 direct items, minDirect 2) still went quiet with
// THIN_FIELD, purely because the specific named competitors (Replicate,
// Together AI, Modal that run) had zero cache/pool coverage. Decided: if the
// direct count already clears the standard on its own, ship the report —
// don't block a passing pool on a cold competitor cache. THIN_FIELD now only
// fires when it would actually EXPLAIN a shortfall (direct is below
// standard, and there's no competitor signal that might have closed the
// gap) — QUIET_GENUINE covers the case where direct is still short even
// with real competitor signal present.

import { itemMatchesTerm } from "./matcher.js";

export const QUIET_CAUSES = {
  QUIET_THIN_POOL: "QUIET_THIN_POOL",
  QUIET_STALE: "QUIET_STALE",
  THIN_FIELD: "THIN_FIELD",
  QUIET_GENUINE: "QUIET_GENUINE",
};

// Session 9b (Avis, 30 Aug): Pass 1 scored a CATEGORY-pool item ("The Hugging
// Face incident...") `direct` at 0.8 with the reason "Hugging Face is a named
// competitor" — but `competitorItemCount` only counts items pre-fetched into
// the entity cache (Phase 2.7's cache-only pre-gate contract), which was cold
// for that entity. The two signals never talked to each other, so THIN_FIELD
// fired on a pool that had already produced a genuine competitor read.
//
// This closes that gap without touching the cache-only rule: after Pass 1
// scores the combined pool, check whether any `direct`-scored item's own
// title/description names one of the brand's competitors — using the same
// word-boundary matcher every source adapter already uses, not a new one.
// This does not fetch anything; it re-reads item text Pass 1 already had.
export function hasCompetitorSignalInPool(scored, competitors) {
  const names = (competitors || []).map((c) => (typeof c === "string" ? c : c.name)).filter(Boolean);
  if (!names.length) return false;
  return (scored || []).some(
    (s) => s.relevance === "direct" && names.some((name) => itemMatchesTerm(s.item, name))
  );
}

export function classifyQuiet({ poolThin, poolStale, competitorItemCount, poolCompetitorHit, direct, minDirect }) {
  if (poolThin) return QUIET_CAUSES.QUIET_THIN_POOL;
  if (poolStale) return QUIET_CAUSES.QUIET_STALE;
  if (direct >= minDirect) return null;
  if (competitorItemCount === 0 && !poolCompetitorHit) return QUIET_CAUSES.THIN_FIELD;
  return QUIET_CAUSES.QUIET_GENUINE;
}
