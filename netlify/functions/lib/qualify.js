// netlify/functions/lib/qualify.js
//
// Step 5 of the category-gates brief: a keyword match on a non-event is
// still a non-event. This module implements ONLY the structurally
// detectable "never qualifies" cases named in the brief:
//   - Ask HN prefix (a personal question, not news)
//   - "top 10" / roundup / listicle titles
// The "null price change" / "no move attached" case is already handled at
// the source: sources/dexscreener.js and sources/coingecko.js drop any item
// whose API response can't supply a magnitude, before it ever reaches this
// filter, so there's nothing left here to re-check.
//
// Explicitly NOT implemented here (per the brief: "propose an approach for
// the rest before building anything... do not add an LLM call here without
// flagging the cost"):
//   - "a repository, package, or tool merely existing" — no structural
//     signal distinguishes an artifact announcement from a real shipped
//     event; this needs semantic judgment.
//   - distinguishing a genuine "named org put this into live operations"
//     from a vendor merely announcing a capability.
// Proposed approach (not built): fold this into Pass 1 of read-pulse.js,
// which already makes a per-item Haiku call over the pool and is the
// natural place to add a boolean "qualifying_event" field alongside the
// existing relevance/relevance_score/one_line_reason fields — same call,
// no new API round trip, so the marginal cost is ~0 extra tokens of output
// per item, not a new $-line-item. Flagging this for a decision before
// touching read-pulse.js, since it changes the Pass 1 contract.

const ASK_HN_RE = /^ask\s+hn\s*:/i;
const LISTICLE_RE = /\b(top\s+\d+|round[\s-]?up|\d+\s+(?:best|top))\b/i;

export function structuralDisqualify(item) {
  const title = item?.title || "";
  if (ASK_HN_RE.test(title)) return "ask_hn";
  if (LISTICLE_RE.test(title)) return "listicle";
  return null;
}

export function passesQualifyingSignal(item) {
  return structuralDisqualify(item) === null;
}
