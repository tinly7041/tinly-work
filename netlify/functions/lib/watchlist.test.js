// netlify/functions/lib/watchlist.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCHLIST, WATCHLIST_ENTITIES } from "./watchlist.js";
import { CATEGORIES } from "./categories.js";

test("exactly four categories, matching categories.js keys, no cybersecurity row", () => {
  const keys = Object.keys(WATCHLIST);
  assert.equal(keys.length, 4);
  assert.deepEqual(new Set(keys), new Set(["ai", "web3", "fintech", "saas"]));
  assert.ok(!("cybersecurity" in WATCHLIST));
  for (const key of keys) assert.ok(key in CATEGORIES, `${key} must be a real category`);
});

test("every category lists 3 seed brands and 6 entities", () => {
  for (const [key, cfg] of Object.entries(WATCHLIST)) {
    assert.equal(cfg.seedBrands.length, 3, `${key} seedBrands`);
    assert.equal(cfg.entities.length, 6, `${key} entities`);
  }
});

test("entity names are canonical headline form, not truncated", () => {
  assert.ok(WATCHLIST.web3.entities.includes("Aerodrome Finance"));
  assert.ok(!WATCHLIST.web3.entities.includes("Aerodrome"));
  assert.ok(WATCHLIST.web3.entities.includes("Curve Finance"));
  assert.ok(WATCHLIST.ai.entities.includes("Google Gemini"));
  assert.ok(WATCHLIST.ai.entities.includes("Mistral AI"));
  assert.ok(WATCHLIST.fintech.entities.includes("Checkout.com"));
});

test("no duplicate entity names across the whole watchlist", () => {
  const all = Object.values(WATCHLIST).flatMap((cfg) => cfg.entities);
  assert.equal(new Set(all).size, all.length);
});

test("WATCHLIST_ENTITIES is a flat 24-item derivation of WATCHLIST", () => {
  assert.equal(WATCHLIST_ENTITIES.length, 24);
  for (const { entity, category } of WATCHLIST_ENTITIES) {
    assert.ok(WATCHLIST[category].entities.includes(entity));
  }
});
