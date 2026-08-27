// netlify/functions/lib/sources/competitor-news.test.js
//
// Unit-tests the pure query-construction and filtering logic only. The live
// network fetch (fetchCompetitorNews -> Google News RSS) is verified live,
// not mocked here — see scripts/competitor-report.js and the Phase 2.7
// report for real query/title output, matching this repo's existing
// convention of live-probing source adapters (scripts/probe-sources.js)
// rather than unit-testing their network calls.
//
// filterForEntity's gate is exclude-only (not the full include/ambiguous+
// context taxonomy) — see the AMENDED comment in competitor-news.js for the
// live evidence that motivated this (a mandatory taxonomy match rejected
// real events like a $7B Stripe acquisition). That means a bare-word entity
// name coincidentally used in an unrelated sense (the brief's own "Retool"
// baseball example) is NOT rejected here if it isn't on the category's
// exclude list — that residual risk is accepted deliberately, backstopped by
// Pass 1 (read-pulse.js), which scores it "none" with full brand context.
// These tests reflect that real tradeoff, not a hypothetical stricter one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompetitorQuery, filterForEntity } from "./competitor-news.js";

test("buildCompetitorQuery quotes the entity and appends the category's queryContext", () => {
  assert.equal(buildCompetitorQuery("Retool", "saas"), '"Retool" software');
  assert.equal(buildCompetitorQuery("Aerodrome", "web3"), '"Aerodrome" crypto');
  assert.equal(buildCompetitorQuery("Wise", "fintech"), '"Wise" fintech');
  assert.equal(buildCompetitorQuery("Perplexity", "ai"), '"Perplexity" AI');
});

test("buildCompetitorQuery throws on an unknown category", () => {
  assert.throws(() => buildCompetitorQuery("Retool", "nope"));
});

test("filterForEntity rejects an item where the entity name itself is absent", () => {
  // Simulates Google's quoted-phrase search being loose in practice — the
  // entity re-check here is the belt-and-suspenders half of the two gates.
  const items = [{ title: "DEX volume rebounds across Base", description: "", url: "https://x.test/1", date: new Date().toISOString() }];
  const { kept, rejected } = filterForEntity(items, "Aerodrome", "web3");
  assert.equal(kept.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "entity_name_absent");
});

test("filterForEntity does NOT require the category taxonomy to independently match — the live-caught Stripe/Aerodrome false-negative case", () => {
  // Real live titles that a mandatory categorize() gate rejected as
  // "no-match" despite being unambiguous, high-value competitor events —
  // see the Phase 2.7 report. None of these repeat fintech's include/
  // ambiguous/context vocabulary, and none are on its exclude list either.
  const items = [
    { title: "Stripe reportedly agrees $7bn acquisition deal for OpenRouter", description: "", url: "https://x.test/2", date: new Date().toISOString() },
    { title: "PayPal Reopens Sale Talks With Stripe After Rejecting First Offer", description: "", url: "https://x.test/3", date: new Date().toISOString() },
  ];
  const { kept, rejected } = filterForEntity(items, "Stripe", "fintech");
  assert.equal(kept.length, 2, "genuine competitor events must survive even without category buzzwords in the headline");
  assert.equal(rejected.length, 0);
});

test("filterForEntity still applies the category's exclude list as a safety net", () => {
  // fintech's exclude list carries unrelated-domain terms (this repo's
  // categories.js reuses the same exclude list to keep biotech/pharma noise
  // out of the fintech pool) — "clinical trial" is one of them.
  const items = [{ title: "Stripe-backed biotech spinout begins a Phase 2 clinical trial", description: "", url: "https://x.test/3", date: new Date().toISOString() }];
  const { kept, rejected } = filterForEntity(items, "Stripe", "fintech");
  assert.equal(kept.length, 0);
  assert.equal(rejected[0].reason, "excluded");
});

test("filterForEntity — the live-caught Uniswap/Hyperliquid/Aerodrome case: a Hyperliquid item must not survive an Aerodrome query", () => {
  const items = [{ title: "Hyperliquid launches its own L2 for perps trading", description: "on-chain perps volume surges", url: "https://x.test/4", date: new Date().toISOString() }];
  const { kept, rejected } = filterForEntity(items, "Aerodrome", "web3");
  assert.equal(kept.length, 0, "a Hyperliquid story must not count as an Aerodrome hit just because both are web3");
  assert.equal(rejected[0].reason, "entity_name_absent");
});
