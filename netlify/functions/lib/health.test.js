import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRunCategory, shouldSendHeartbeat, evaluateAlerts, buildCategorySummary, CADENCE_DAYS, STALE_HOURS } from "./health.js";

test("a category with no prior state is always due", () => {
  assert.equal(shouldRunCategory(null), true);
  assert.equal(shouldRunCategory({ lastSuccessAt: null, lastAttemptOk: null }), true);
});

test("a failed last attempt is always due, regardless of cadence", () => {
  const yesterday = new Date(Date.now() - 20 * 36e5).toISOString(); // 20h ago — not yet due by cadence
  assert.equal(shouldRunCategory({ lastSuccessAt: yesterday, lastAttemptAt: yesterday, lastAttemptOk: false }), true);
});

test("a recent success is not due until CADENCE_DAYS pass", () => {
  const recent = new Date(Date.now() - 10 * 36e5).toISOString(); // 10h ago
  const stale = new Date(Date.now() - (CADENCE_DAYS * 24 + 1) * 36e5).toISOString();
  assert.equal(shouldRunCategory({ lastSuccessAt: recent, lastAttemptOk: true }), false);
  assert.equal(shouldRunCategory({ lastSuccessAt: stale, lastAttemptOk: true }), true);
});

test("heartbeat fires with no prior send and after 7 days, not before", () => {
  assert.equal(shouldSendHeartbeat(null), true);
  assert.equal(shouldSendHeartbeat({ lastSentAt: new Date().toISOString() }), false);
  assert.equal(shouldSendHeartbeat({ lastSentAt: new Date(Date.now() - 8 * 24 * 36e5).toISOString() }), true);
});

test("evaluateAlerts fires on source failure, health floor, zero items, and stale cache — never on plain success", () => {
  const healthy = buildCategorySummary({
    category: "ai",
    outcome: "ok",
    result: { items: [{ source: "hn" }], health: { per_source: { hn: 1 }, healthy: true } },
    failures: [],
    state: { lastSuccessAt: new Date().toISOString() },
  });
  assert.deepEqual(evaluateAlerts([healthy]), []);

  const withFailure = buildCategorySummary({
    category: "saas",
    outcome: "ok",
    result: { items: [{ source: "hn" }], health: { per_source: { hn: 1 }, healthy: false } },
    failures: [{ source: "lobsters", error: "timeout" }],
    state: { lastSuccessAt: new Date().toISOString() },
  });
  const alerts = evaluateAlerts([withFailure]);
  assert.ok(alerts.some((a) => a.type === "source_failure"));
  assert.ok(alerts.some((a) => a.type === "health_floor"));

  const zeroItems = buildCategorySummary({
    category: "web3",
    outcome: "ok",
    result: { items: [], health: { per_source: {}, healthy: false } },
    failures: [],
    state: { lastSuccessAt: new Date().toISOString() },
  });
  assert.ok(evaluateAlerts([zeroItems]).some((a) => a.type === "zero_items"));

  const staleCache = buildCategorySummary({
    category: "fintech",
    outcome: "skipped_not_due",
    state: { lastSuccessAt: new Date(Date.now() - (STALE_HOURS + 1) * 36e5).toISOString() },
  });
  assert.ok(evaluateAlerts([staleCache]).some((a) => a.type === "stale_cache"));
});

test("a crawl failure alerts even though it carries no item counts", () => {
  const failed = buildCategorySummary({
    category: "fintech",
    outcome: "failed",
    error: "network down",
    state: { lastSuccessAt: new Date().toISOString() },
  });
  assert.ok(evaluateAlerts([failed]).some((a) => a.type === "crawl_failed"));
});
