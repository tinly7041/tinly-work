// netlify/functions/lib/matcher.js
//
// The single shared keyword-matching engine for every source adapter. Nothing
// reimplements this — see categories.js's three-list structure (include /
// ambiguous / context / exclude) and the 23 Aug postmortem this file exists
// to fix: "ledger" (bare substring) matched achieve/cache-shaped false
// positives, single ambiguous words with no validating context qualified
// items outright, and exclusions were never checked at all.
//
// Five rules, non-negotiable (see Step 1 of the category-gates brief):
//   1. Word-boundary matching only — no substring matches.
//   2. Terms of <=4 characters match case-sensitively, uppercase only.
//   3. Multi-word phrases match as contiguous phrases, not as separately
//      satisfied words.
//   4. Match against title AND description (checked as two separate fields,
//      never concatenated — concatenating would let a phrase span the
//      title/description boundary and match something that was never
//      actually written contiguously).
//   5. Exclusions beat includes, always.

const SHORT_TERM_MAX_LEN = 4;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const _regexCache = new Map();

// A term matches only when neither the character immediately before nor
// immediately after it is a word character (letter/digit/underscore). That
// is true word-boundary matching for both single words and multi-word
// phrases (the space inside a phrase is not a boundary the lookaround cares
// about — only the two outer edges are). Terms of 4 characters or fewer are
// matched case-sensitively so acronyms like MEV, ACH, DEX stay precise;
// longer terms/phrases match case-insensitively.
function termRegex(term) {
  let re = _regexCache.get(term);
  if (re) return re;
  const short = term.length <= SHORT_TERM_MAX_LEN;
  const escaped = escapeRegExp(term);
  re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, short ? "" : "i");
  _regexCache.set(term, re);
  return re;
}

// Rule 2's case-sensitivity is on the TERM's length, not the matched text's
// case — so a short term is compared as written (the term lists in
// categories.js write these in canonical uppercase, e.g. "MEV", "DEX").
export function termMatches(text, term) {
  if (!text || !term) return false;
  return termRegex(term).test(text);
}

// Rule 4: title and description are checked as independent fields.
export function itemMatchesTerm(item, term) {
  return termMatches(item?.title || "", term) || termMatches(item?.description || "", term);
}

export function firstItemMatch(item, terms) {
  for (const t of terms || []) {
    if (itemMatchesTerm(item, t)) return t;
  }
  return null;
}

export function anyItemMatch(item, terms) {
  return firstItemMatch(item, terms) !== null;
}

// ---------- category taxonomy match ----------
//
// catCfg = { include, ambiguous, context, exclude }. Rule 5: exclude is
// checked first and wins regardless of anything else. An include hit
// qualifies alone. An ambiguous hit only qualifies when a context term is
// also present (checked as a separate, independent match — the ambiguous
// term and the context term do not need to be the same field, both title
// and description are searched for each).
export function categorize(item, catCfg) {
  const excludeHit = firstItemMatch(item, catCfg.exclude);
  if (excludeHit) return { matched: false, reason: "excluded", term: excludeHit };

  const includeHit = firstItemMatch(item, catCfg.include);
  if (includeHit) return { matched: true, reason: "include", term: includeHit };

  const ambiguousHit = firstItemMatch(item, catCfg.ambiguous);
  if (ambiguousHit) {
    const contextHit = firstItemMatch(item, catCfg.context);
    if (contextHit) {
      return { matched: true, reason: "ambiguous+context", term: ambiguousHit, context: contextHit };
    }
  }

  return { matched: false, reason: "no-match", term: null };
}
