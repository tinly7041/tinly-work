// netlify/functions/lib/matcher.test.js
//
// Proves the five matcher rules against the exact false positives named in
// the category-gates brief: ACH~achieve/cache, DEX~index, DA~data/update,
// MEV lowercase, and a split "flash loan exploit" phrase. Run with:
//   node --test netlify/functions/lib

import { test } from "node:test";
import assert from "node:assert/strict";
import { termMatches, itemMatchesTerm, firstItemMatch, categorize } from "./matcher.js";

test("rule 1 — word-boundary matching, no substrings", () => {
  assert.equal(termMatches("we need to achieve this", "ACH"), false, "ACH must not match inside achieve");
  assert.equal(termMatches("clear the cache first", "ACH"), false, "ACH must not match inside cache");
  assert.equal(termMatches("wire it over ACH", "ACH"), true, "ACH must match as a standalone word");

  assert.equal(termMatches("build a search index", "DEX"), false, "DEX must not match inside index");
  assert.equal(termMatches("swap it on a DEX", "DEX"), true, "DEX must match as a standalone word");
});

test("rule 2 — terms <=4 chars are case-sensitive, uppercase only", () => {
  assert.equal(termMatches("collecting user data today", "DA"), false, "DA must not match inside data");
  assert.equal(termMatches("we shipped an update", "DA"), false, "DA must not match inside update");
  assert.equal(termMatches("the DA layer is live", "DA"), true, "uppercase DA must match as a word");
  assert.equal(termMatches("the da layer is live", "DA"), false, "lowercase da must NOT match a <=4-char term");

  assert.equal(termMatches("a bot got mev'd on the mempool", "MEV"), false, "lowercase mev must not match");
  assert.equal(termMatches("a bot got MEV'd on the mempool", "MEV"), true, "uppercase MEV must match");

  // Longer terms are case-insensitive by contrast.
  assert.equal(termMatches("a new STABLECOIN launched", "stablecoin"), true, ">4-char terms are case-insensitive");
});

test("rule 3 — multi-word phrases match as phrases, not as separate words", () => {
  const split = "there was a flash sale on a loan product, unrelated to any exploit";
  const contiguous = "researchers demoed a flash loan exploit live";
  assert.equal(termMatches(split, "flash loan exploit"), false, "split occurrences must not satisfy the phrase");
  assert.equal(termMatches(contiguous, "flash loan exploit"), true, "the literal phrase must match");
});

test("rule 4 — matches against title and description as independent fields", () => {
  const item = { title: "Company launches new product", description: "a fresh DEX for perps" };
  assert.equal(itemMatchesTerm(item, "DEX"), true, "should find a term that only appears in description");
  assert.equal(
    termMatches(`${item.title} ${item.description}`.slice(0, item.title.length), "DEX"),
    false,
    "sanity: DEX truly is absent from the title alone"
  );

  // A phrase must not be satisfied by spanning the title/description boundary.
  const spanning = { title: "We built a flash loan", description: "exploit demo for a workshop" };
  assert.equal(itemMatchesTerm(spanning, "flash loan exploit"), false, "phrase must not span title+description");
});

test("rule 5 — exclusions beat includes, always", () => {
  const catCfg = {
    include: ["stablecoin"],
    ambiguous: [],
    context: [],
    exclude: ["memecoin sniper"],
  };
  const item = { title: "New stablecoin doubles as a memecoin sniper bot", description: "" };
  const result = categorize(item, catCfg);
  assert.equal(result.matched, false);
  assert.equal(result.reason, "excluded");
});

test("categorize — include alone qualifies", () => {
  const catCfg = { include: ["payment rails"], ambiguous: [], context: [], exclude: [] };
  const item = { title: "Startup rebuilds its payment rails", description: "" };
  const result = categorize(item, catCfg);
  assert.equal(result.matched, true);
  assert.equal(result.reason, "include");
});

test("categorize — ambiguous alone does NOT qualify without context", () => {
  const catCfg = {
    include: [],
    ambiguous: ["ledger"],
    context: ["payment", "bank", "financial"],
    exclude: [],
  };
  const item = { title: "A 292-card source ledger for a trivia book", description: "" };
  const result = categorize(item, catCfg);
  assert.equal(result.matched, false, "bare 'ledger' with no fintech context must not qualify");
});

test("categorize — ambiguous + context together qualify", () => {
  const catCfg = {
    include: [],
    ambiguous: ["ledger"],
    context: ["payment", "bank", "financial"],
    exclude: [],
  };
  const item = { title: "Regional bank modernizes its core ledger", description: "" };
  const result = categorize(item, catCfg);
  assert.equal(result.matched, true);
  assert.equal(result.reason, "ambiguous+context");
});

// "bank" and "card" are exactly 4 characters, so rule 2 makes them
// case-sensitive like any other short term. Since the FinTech context list
// (see categories.js) writes them lowercase, they validate lowercase
// occurrences but not a sentence-initial capitalized "Bank" — a real,
// foreseeable consequence of applying rule 2 literally to a plain word
// rather than an acronym. Documented here, not silently patched around.
test("rule 2 side effect — a lowercase 4-char context word does not match its capitalized form", () => {
  assert.equal(termMatches("Bank modernizes its core ledger", "bank"), false);
  assert.equal(termMatches("regional bank modernizes its core ledger", "bank"), true);
});

test("firstItemMatch returns null when nothing matches", () => {
  assert.equal(firstItemMatch({ title: "unrelated", description: "" }, ["ACH", "SEPA"]), null);
});
