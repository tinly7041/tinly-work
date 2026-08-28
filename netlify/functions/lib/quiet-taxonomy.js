// netlify/functions/lib/quiet-taxonomy.js
//
// Pre-gate quiet/thin classification. Pure function, no I/O. The precedence
// order is explicit and sequential per the brief — poolThin beats poolStale
// beats zero competitor items beats low direct count.

export const QUIET_CAUSES = {
  QUIET_THIN_POOL: "QUIET_THIN_POOL",
  QUIET_STALE: "QUIET_STALE",
  THIN_FIELD: "THIN_FIELD",
  QUIET_GENUINE: "QUIET_GENUINE",
};

export function classifyQuiet({ poolThin, poolStale, competitorItemCount, direct, minDirect }) {
  if (poolThin) return QUIET_CAUSES.QUIET_THIN_POOL;
  if (poolStale) return QUIET_CAUSES.QUIET_STALE;
  if (competitorItemCount === 0) return QUIET_CAUSES.THIN_FIELD;
  if (direct < minDirect) return QUIET_CAUSES.QUIET_GENUINE;
  return null;
}
