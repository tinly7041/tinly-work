// netlify/functions/lib/read-pulse.test.js
//
// Fix-pass brief, Fix 2: MOCK-verified — not a substitute for the live
// frozen-pool re-run also done for this brief (see fix-pass-report.md for
// that live measurement). Exercises the one-retry-on-parse-failure path via
// an injected fetchImpl, distinguishing Pass 1's tool-call request (by the
// presence of `tools` in the request body) from Pass 2's plain-text
// request so each can be scripted independently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePulseRead } from "./read-pulse.js";

const POOL_ITEM = { title: "Item A", url: "https://x.test/a", source: "test", date: new Date().toISOString() };

// One item, scored "direct" + is_event so it survives Pass 1's gates and
// Pass 2 actually gets called — a pool that never reaches Pass 2 can't
// exercise this retry path at all.
function pass1Response() {
  return {
    content: [
      {
        type: "tool_use",
        name: "score_pool_items",
        input: { scores: [{ index: 0, relevance_score: 0.9, relevance: "direct", one_line_reason: "test", is_event: true }] },
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const VALID_PASS2_JSON = JSON.stringify({
  pulse_summary: "test summary",
  items: [{ headline: "Item A", url: "https://x.test/a", source: "test", relevance: "direct", effort: "quick", why_now: "x", so_what: "x", payoff: "x" }],
});

// fetchImpl distinguishes Pass 1 (tools present) from Pass 2 (no tools) by
// request shape, not by call order — the two passes are genuinely
// different requests in production, so the mock should tell them apart the
// same way a real inspection would.
function makeMockFetch({ pass2Texts, pass2HttpError = null }) {
  let pass2Calls = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.tools) {
      return { ok: true, json: async () => pass1Response() };
    }
    pass2Calls++;
    if (pass2HttpError && pass2Calls === 1) {
      return { ok: false, text: async () => pass2HttpError };
    }
    const text = pass2Texts[Math.min(pass2Calls, pass2Texts.length) - 1];
    return { ok: true, json: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 5 } }) };
  };
  return { fetchImpl, getPass2Calls: () => pass2Calls };
}

const baseArgs = {
  brandName: "TestBrand",
  website: "test.example",
  brandRead: "a test brand",
  primaryCategory: "saas",
  secondaryCategory: null,
  primaryPool: { items: [POOL_ITEM] },
  secondaryPool: null,
  anthropicApiKey: "fake-key",
};

test("Pass 2 succeeds on the first attempt: no retry, parse_attempts=1", async () => {
  const { fetchImpl, getPass2Calls } = makeMockFetch({ pass2Texts: [VALID_PASS2_JSON] });
  const { debug } = await generatePulseRead({ ...baseArgs, fetchImpl });
  assert.equal(getPass2Calls(), 1);
  assert.equal(debug.pass2.parse_attempts, 1);
  assert.equal(debug.pass2.recovered_by_retry, false);
  assert.notEqual(debug.standards.failed_standard, "pass2_unparseable");
});

test("Pass 2 fails to parse once, then succeeds: exactly one retry, recovered_by_retry=true", async () => {
  const { fetchImpl, getPass2Calls } = makeMockFetch({ pass2Texts: ["this is not valid json {{{", VALID_PASS2_JSON] });
  const { debug } = await generatePulseRead({ ...baseArgs, fetchImpl });
  assert.equal(getPass2Calls(), 2, "must call Pass 2 exactly twice: the failing attempt and the one retry");
  assert.equal(debug.pass2.parse_attempts, 2);
  assert.equal(debug.pass2.recovered_by_retry, true);
  assert.notEqual(debug.standards.failed_standard, "pass2_unparseable", "a recovered parse must not still degrade via the unparseable path");
});

test("Pass 2 fails to parse on both attempts: degrades to quiet after exactly 2 calls, not 3", async () => {
  const { fetchImpl, getPass2Calls } = makeMockFetch({ pass2Texts: ["not json {{{", "still not json {{{"] });
  const { result, debug } = await generatePulseRead({ ...baseArgs, fetchImpl });
  assert.equal(getPass2Calls(), 2, "must stop after one retry, not retry forever");
  assert.equal(result.quiet, true);
  assert.equal(debug.standards.failed_standard, "pass2_unparseable");
  assert.equal(debug.pass2.parse_attempts, 2);
});

test("a genuine Pass 2 API error is NOT retried — propagates immediately, exactly one call", async () => {
  const { fetchImpl, getPass2Calls } = makeMockFetch({ pass2Texts: [VALID_PASS2_JSON], pass2HttpError: "503 service unavailable" });
  await assert.rejects(() => generatePulseRead({ ...baseArgs, fetchImpl }), /Anthropic API error/);
  assert.equal(getPass2Calls(), 1, "an HTTP error must not trigger the parse-failure retry loop");
});

test("Pass 2 returning valid JSON with an empty items array is NOT treated as a parse failure — no retry", async () => {
  const emptyItemsJson = JSON.stringify({ pulse_summary: "quiet week", items: [] });
  const { fetchImpl, getPass2Calls } = makeMockFetch({ pass2Texts: [emptyItemsJson] });
  const { debug } = await generatePulseRead({ ...baseArgs, fetchImpl });
  assert.equal(getPass2Calls(), 1, "a parseable-but-empty response must not be retried");
  assert.equal(debug.pass2.parse_attempts, 1);
  assert.notEqual(debug.standards.failed_standard, "pass2_unparseable");
  assert.equal(debug.standards.failed_standard, "min_items", "an empty item list fails the normal min_items floor, not the parse-retry path");
});
