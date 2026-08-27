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
import { buildCompetitorQuery, filterForEntity, fetchGoogleNewsRaw } from "./competitor-news.js";

// ---------- fix-pass brief, item 1a: retry-on-empty, MOCK-verified ----------
//
// Fix-pass brief: live-verify by hammering real queries until an empty is
// observed in the wild. Did that — see the fix-pass report: 61 live calls
// across 5 entities (Uniswap, Solana, Ethereum, Tether) and 2 methodologies
// (in-process loop, fresh separate processes matching the original
// discovery method), zero empties reproduced this session, despite the
// phenomenon being real and previously documented with concrete evidence.
// Per the brief's own instruction ("if you cannot reproduce an empty... say
// so plainly — do not simulate one and call the fix verified"), that live
// gap is reported as a gap, not papered over. What CAN be verified without
// pretending it's live: the retry loop's own logic — attempt counting,
// break-on-first-success, break-on-error (never retried), the exhausted-
// after-N-attempts case — via an injected fake network call. This is
// MOCK-verified, not live-verified, and is not a substitute for the live
// attempt above.
const XML_EMPTY = `<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>`;
const xmlWithItems = (n) =>
  `<?xml version="1.0"?><rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>Item ${i}</title><link>https://x.test/${i}</link></item>`).join("")}</channel></rss>`;

function fakeSleep(calls) {
  return async (ms) => {
    calls.push(ms);
  };
}

test("fetchGoogleNewsRaw: succeeds on the first attempt, no retry, no sleep", async () => {
  let calls = 0;
  const sleepCalls = [];
  const getImpl = async () => {
    calls++;
    return xmlWithItems(3);
  };
  const { items, fetch_meta } = await fetchGoogleNewsRaw('"Test" software', { getImpl, sleepImpl: fakeSleep(sleepCalls) });
  assert.equal(calls, 1);
  assert.equal(sleepCalls.length, 0, "must not sleep when the first attempt already succeeded");
  assert.equal(items.length, 3);
  assert.equal(fetch_meta.attempts, 1);
  assert.equal(fetch_meta.exhausted_empty, false);
  assert.equal(fetch_meta.http_error, null);
});

test("fetchGoogleNewsRaw: empty then non-empty — recovers on retry, one sleep, attempts=2", async () => {
  let calls = 0;
  const sleepCalls = [];
  const getImpl = async () => {
    calls++;
    return calls === 1 ? XML_EMPTY : xmlWithItems(5);
  };
  const { items, fetch_meta } = await fetchGoogleNewsRaw('"Test" software', { getImpl, sleepImpl: fakeSleep(sleepCalls) });
  assert.equal(calls, 2);
  assert.equal(sleepCalls.length, 1, "exactly one backoff sleep between the empty attempt and the recovering one");
  assert.equal(items.length, 5);
  assert.equal(fetch_meta.attempts, 2);
  assert.equal(fetch_meta.exhausted_empty, false, "recovering on retry must not be reported as exhausted");
});

test("fetchGoogleNewsRaw: empty on every attempt — exhausted_empty=true, exactly 3 attempts, no 4th call", async () => {
  let calls = 0;
  const sleepCalls = [];
  const getImpl = async () => {
    calls++;
    return XML_EMPTY;
  };
  const { items, fetch_meta } = await fetchGoogleNewsRaw('"Test" software', { getImpl, sleepImpl: fakeSleep(sleepCalls) });
  assert.equal(calls, 3, "must stop at the attempt cap, not retry forever");
  assert.equal(sleepCalls.length, 2, "sleeps between attempts 1->2 and 2->3, not after the final attempt");
  assert.equal(items.length, 0);
  assert.equal(fetch_meta.attempts, 3);
  assert.equal(fetch_meta.exhausted_empty, true);
  assert.equal(fetch_meta.http_error, null, "genuinely empty is not the same failure mode as an HTTP error");
});

test("fetchGoogleNewsRaw: an HTTP/network error is NOT retried, even on the first attempt", async () => {
  let calls = 0;
  const sleepCalls = [];
  const getImpl = async () => {
    calls++;
    throw new Error("HTTP 503 simulated");
  };
  const { items, fetch_meta } = await fetchGoogleNewsRaw('"Test" software', { getImpl, sleepImpl: fakeSleep(sleepCalls) });
  assert.equal(calls, 1, "an HTTP error must not trigger the empty-retry loop");
  assert.equal(sleepCalls.length, 0);
  assert.equal(items.length, 0);
  assert.equal(fetch_meta.exhausted_empty, false, "an HTTP error is a distinct failure mode from a genuine empty");
  assert.match(fetch_meta.http_error, /HTTP 503 simulated/);
});

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
