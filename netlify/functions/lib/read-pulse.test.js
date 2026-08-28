// netlify/functions/lib/read-pulse.test.js
//
// Unit tests for the pre-gate/post-gate split. Uses mock API responses
// so no real Anthropic calls are made.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runPreGate,
  runPostGate,
  generatePulseRead,
  selectPool,
  scoreDistribution,
  applyEventGate,
  selectTopN,
  ACTION_STANDARDS,
  PAYOFF_QUANT_PATTERN,
} from "./read-pulse.js";

const DISTINCT_TITLES = [
  "OpenAI launches GPT-5 multimodal reasoning",
  "Stripe acquires fintech startup Paystack",
  "Google Gemini adds coding agent features",
  "Binance settles regulatory compliance case",
  "Notion ships enterprise database connectors",
];

function makeItem(title, source = "test-source", overrides = {}) {
  return {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    source,
    date: "2026-08-25",
    score: 0.5,
    ...overrides,
  };
}

function makePass1Response(items, overrides = []) {
  const scores = items.map((item, idx) => ({
    index: idx,
    relevance_score: 0.8,
    relevance: "direct",
    one_line_reason: "test reason",
    is_event: true,
    ...(overrides[idx] || {}),
  }));
  return {
    content: [{ type: "tool_use", name: "score_pool_items", input: { scores } }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makePass2Response(items) {
  const resultItems = items.map((item) => ({
    headline: item.title,
    url: item.url,
    source: item.source,
    relevance: "direct",
    effort: "quick",
    why_now: "test why now",
    so_what: "test so what",
    payoff: "test payoff, no numbers",
  }));
  return {
    content: [{ type: "text", text: JSON.stringify({ pulse_summary: "Test summary", items: resultItems }) }],
    usage: { input_tokens: 200, output_tokens: 100 },
  };
}

function mockFetch(pass1Items, pass2Items) {
  let callCount = 0;
  return async (url, opts) => {
    callCount++;
    const body = JSON.parse(opts.body);
    const isPass1 = body.tools && body.tools[0]?.name === "score_pool_items";
    return {
      ok: true,
      json: async () => isPass1 ? makePass1Response(pass1Items) : makePass2Response(pass2Items || pass1Items),
    };
  };
}

const baseCtx = {
  brandName: "TestBrand",
  website: "https://test.com",
  brandRead: "A test brand",
  primaryCategory: "ai",
  secondaryCategory: null,
  competitors: [],
};

test("selectPool combines primary + secondary + competitor items", () => {
  const primary = { items: [makeItem("A")] };
  const secondary = { items: [makeItem("B")] };
  const competitor = [makeItem("C", "competitor")];
  const { items } = selectPool(primary, secondary, competitor);
  assert.equal(items.length, 3);
});

test("applyEventGate drops non-events", () => {
  const scored = [
    { is_event: true, item: makeItem("event") },
    { is_event: false, item: makeItem("not event") },
  ];
  const { kept, dropped } = applyEventGate(scored);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
  assert.equal(kept[0].item.title, "event");
});

test("scoreDistribution counts direct/indirect/none", () => {
  const scored = [
    { relevance: "direct" },
    { relevance: "direct" },
    { relevance: "indirect" },
    { relevance: "none" },
  ];
  const dist = scoreDistribution(scored);
  assert.equal(dist.direct, 2);
  assert.equal(dist.indirect, 1);
  assert.equal(dist.none, 1);
  assert.equal(dist.total, 4);
});

test("PAYOFF_QUANT_PATTERN catches fabricated quantities", () => {
  assert.ok(PAYOFF_QUANT_PATTERN.test("could lift engagement 30%"));
  assert.ok(PAYOFF_QUANT_PATTERN.test("2x reach"));
  assert.ok(PAYOFF_QUANT_PATTERN.test("hundreds of impressions"));
  assert.ok(PAYOFF_QUANT_PATTERN.test("$50 per click"));
  assert.ok(!PAYOFF_QUANT_PATTERN.test("makes the category argument on your terms"));
});

test("runPreGate returns quiet:true on empty pool", async () => {
  const result = await runPreGate({
    ...baseCtx,
    primaryPool: { items: [] },
    secondaryPool: null,
    competitorItems: [],
    anthropicApiKey: "test",
    fetchImpl: mockFetch([]),
  });
  assert.equal(result.quiet, true);
  assert.equal(result.top.length, 0);
});

test("runPreGate returns scored items on a real pool", async () => {
  const items = DISTINCT_TITLES.map((t, i) => makeItem(t, `source-${i}`));
  const result = await runPreGate({
    ...baseCtx,
    primaryPool: { items },
    secondaryPool: null,
    competitorItems: [],
    anthropicApiKey: "test",
    fetchImpl: mockFetch(items),
  });
  assert.equal(result.quiet, false);
  assert.ok(result.top.length > 0);
  assert.equal(result.scored.length, 5);
  assert.ok(result.distribution);
});

test("runPostGate returns quiet on empty top", async () => {
  const result = await runPostGate({
    ...baseCtx,
    top: [],
    anthropicApiKey: "test",
    fetchImpl: mockFetch([]),
  });
  assert.equal(result.result.quiet, true);
});

test("runPostGate returns a pulse result when standards pass", async () => {
  const items = DISTINCT_TITLES.map((t, i) => makeItem(t, `source-${i}`));
  const top = items.map((item) => ({
    item,
    relevance: "direct",
    relevance_score: 0.9,
    one_line_reason: "test",
    is_event: true,
  }));
  const result = await runPostGate({
    ...baseCtx,
    top,
    anthropicApiKey: "test",
    fetchImpl: mockFetch([], items),
  });
  assert.equal(result.result.quiet, false);
  assert.ok(result.result.items.length >= ACTION_STANDARDS.minItems);
  assert.ok(result.standards.pass);
});

test("generatePulseRead composes pre-gate + post-gate identically", async () => {
  const items = DISTINCT_TITLES.map((t, i) => makeItem(t, `source-${i}`));
  const fetchFn = mockFetch(items, items);
  const args = {
    ...baseCtx,
    primaryPool: { items },
    secondaryPool: null,
    competitorItems: [],
    anthropicApiKey: "test",
    fetchImpl: fetchFn,
  };
  const { result, debug } = await generatePulseRead(args);
  assert.equal(result.quiet, false);
  assert.ok(debug.pass1);
  assert.ok(debug.pass2);
  assert.ok(typeof debug.total_cost === "number");
});
