// netlify/functions/lib/entity-cache.test.js
//
// Exercises real file I/O against .cache/entities/ (gitignored), same as
// this repo's other local-cache-backed modules (pool.js) rely on live
// filesystem behavior rather than a mocked fs. Each test uses its own
// unique entity name so runs never collide or depend on ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "fs/promises";
import path from "path";
import { getCachedEntity, setCachedEntity, normalizeEntityName, ENTITY_CACHE_TTL_MS, UNCERTAIN_CACHE_TTL_MS } from "./entity-cache.js";

test("normalizeEntityName lowercases, trims, and collapses whitespace", () => {
  assert.equal(normalizeEntityName("  Aerodrome  Finance "), "aerodrome finance");
  assert.equal(normalizeEntityName("Retool"), "retool");
});

test("round-trip: set then get returns the same data, fresh", async () => {
  const entity = `TestEntity-${Date.now()}-A`;
  const written = await setCachedEntity(entity, { category: "saas", query: '"TestEntity" software', items: [{ title: "x" }], rejected: [] });
  assert.equal(written.entity, entity);
  assert.ok(written.fetched_at);

  const read = await getCachedEntity(entity);
  assert.ok(read, "expected a fresh cache hit right after writing");
  assert.equal(read.category, "saas");
  assert.equal(read.items.length, 1);
});

test("a cache entry older than the TTL reads as absent", async () => {
  const entity = `TestEntity-${Date.now()}-B`;
  await setCachedEntity(entity, { category: "saas", query: "q", items: [] });

  // getCachedEntity's ttlMs override lets the freshness check be exercised
  // without waiting 7 real days or reaching into the file on disk.
  const readWithZeroTtl = await getCachedEntity(entity, { ttlMs: -1 });
  assert.equal(readWithZeroTtl, null, "an entry older than a negative TTL must read as absent");

  const readNormally = await getCachedEntity(entity);
  assert.ok(readNormally, "the same entry read with the real TTL is still fresh");
});

test("a missing entity reads as null, not a throw", async () => {
  // No local file exists for this entity, so getCachedEntity falls through
  // to Blobs — mocked here (same DI pattern as crawl-trends.js's
  // getStoreImpl) so this test doesn't depend on real Netlify Blobs
  // credentials being configured in the environment.
  const mockStore = { get: async () => null };
  const result = await getCachedEntity(`NeverWritten-${Date.now()}`, { getStore: () => mockStore });
  assert.equal(result, null);
});

test("ENTITY_CACHE_TTL_MS is exactly 7 days", () => {
  assert.equal(ENTITY_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test("UNCERTAIN_CACHE_TTL_MS is exactly 1 hour", () => {
  assert.equal(UNCERTAIN_CACHE_TTL_MS, 60 * 60 * 1000);
});

// Fix-pass brief, item 1b: an "ok" verdict gets the full 7-day TTL; an
// unresolved one (empty-after-retries, or a fetch error) gets the much
// shorter uncertain-result TTL — so a bad window can't masquerade as a
// week-long "no coverage" verdict. Forces a controlled age via a mocked
// Blobs store (no local file exists for these entity names, so
// getCachedEntity falls through to the mock) rather than waiting real time.
test("status=ok reads as fresh at 2 hours old (well within the 7-day TTL)", async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mockStore = { get: async () => ({ fetched_at: twoHoursAgo, status: "ok", items: [{ title: "real event" }] }) };
  const result = await getCachedEntity(`Uncached-Ok-${Date.now()}`, { getStore: () => mockStore });
  assert.ok(result, "an 'ok' entry at 2 hours old must still be fresh");
});

test("status=empty_retries_exhausted reads as STALE at 2 hours old, despite being well within the 7-day TTL", async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mockStore = { get: async () => ({ fetched_at: twoHoursAgo, status: "empty_retries_exhausted", items: [] }) };
  const result = await getCachedEntity(`Uncached-Exhausted-${Date.now()}`, { getStore: () => mockStore });
  assert.equal(result, null, "an unresolved empty result older than 1 hour must not be trusted as a week-long verdict");
});

test("status=fetch_error gets the same short TTL treatment as empty_retries_exhausted", async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mockStore = { get: async () => ({ fetched_at: twoHoursAgo, status: "fetch_error", items: [] }) };
  const result = await getCachedEntity(`Uncached-Error-${Date.now()}`, { getStore: () => mockStore });
  assert.equal(result, null);
});

test("an entry with no status field (written before this field existed) falls back to the full 7-day TTL", async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mockStore = { get: async () => ({ fetched_at: twoHoursAgo, items: [{ title: "pre-existing entry" }] }) };
  const result = await getCachedEntity(`Uncached-Legacy-${Date.now()}`, { getStore: () => mockStore });
  assert.ok(result, "a status-less legacy entry must not be treated as newly-uncertain");
});

test("an explicit ttlMs override always wins, regardless of status", async () => {
  const entity = `TestEntity-${Date.now()}-C`;
  await setCachedEntity(entity, { category: "saas", query: "q", items: [{ title: "x" }], status: "ok" });
  const result = await getCachedEntity(entity, { ttlMs: -1 });
  assert.equal(result, null, "an explicit ttlMs must override the status-based default even for an 'ok' entry");
});

test.after(async () => {
  // Best-effort cleanup of this test file's own scratch entries — leaves no
  // trace in the gitignored .cache/entities/ dir beyond the test run.
  await rm(path.resolve(process.cwd(), ".cache", "entities"), { recursive: true, force: true });
});
