// netlify/functions/lib/lead-store.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadRow, buildReportHtml, timeSignal, postLead, postReport, postLeadFailure, postLeadFallback } from "./lead-store.js";

// Frozen "now" for age-based tests, so a test that passes today doesn't
// silently start failing once real elapsed time drifts the boundary.
const NOW = Date.parse("2026-09-05T00:00:00.000Z");
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();

test("buildLeadRow sets action:lead and blanks whatsapp/telegram", () => {
  const row = buildLeadRow({
    name: "Ada", email: "ada@x.com", role: "Founder", company: "X Co",
    brandName: "Brand", website: "https://brand.com", category: "saas",
    confidence: 0.8, directCount: 3, reportSent: false,
    competitorsSource: "user", competitorsList: "Notion, Linear", quietCause: "",
  });
  assert.equal(row.action, "lead");
  assert.equal(row.whatsapp, "");
  assert.equal(row.telegram, "");
  assert.equal(row.reportSent, "No");
  assert.equal(row.directCount, 3);
  assert.equal(row.competitors_list, "Notion, Linear");
});

test("buildLeadRow defaults missing fields to empty string, not undefined", () => {
  const row = buildLeadRow({ email: "a@b.com" });
  assert.equal(row.name, "");
  assert.equal(row.company, "");
  assert.equal(typeof row.timestamp, "string");
});

test("buildReportHtml escapes HTML-significant characters in LLM-generated fields", () => {
  const html = buildReportHtml({
    brandName: 'Brand <script>alert(1)</script> & "Co"',
    result: {
      pulse_summary: "Summary with <b>tags</b> & \"quotes\"",
      items: [
        {
          headline: "Item <one> & \"two\"",
          source: "Source & Co",
          url: "https://example.com/a?x=1&y=2",
          relevance: "direct",
          effort: "quick",
          why_now: "Because <this>",
          so_what: "So <what>",
          payoff: "Payoff & stakes",
        },
      ],
    },
  });
  assert.ok(!html.includes("<script>"), "raw <script> must never appear unescaped");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;two&quot;"));
  assert.ok(html.includes("Item &lt;one&gt;"));
});

test("buildReportHtml handles an empty items array without throwing", () => {
  const html = buildReportHtml({ brandName: "Brand", result: { pulse_summary: "quiet", items: [] } });
  assert.ok(html.includes("Brand"));
  assert.ok(html.includes("quiet"));
});

test("postLead sends secret + row fields, throws on non-ok response", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true };
  };
  await postLead(fetchImpl, "https://script.example/exec", "shh", { action: "lead", email: "a@b.com" });
  assert.equal(captured.body.secret, "shh");
  assert.equal(captured.body.email, "a@b.com");

  const failFetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(() => postLead(failFetch, "https://script.example/exec", "shh", {}));
});

test("postReport sends action:report and reportHtml, never a raw report object", async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true };
  };
  await postReport(fetchImpl, "https://script.example/exec", "shh", {
    email: "a@b.com", brandName: "Brand", reportHtml: "<div>hi</div>",
  });
  assert.equal(captured.action, "report");
  assert.equal(captured.reportHtml, "<div>hi</div>");
  assert.equal(captured.report, undefined);
});

test("timeSignal — 2d, 1 source → fresh", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(2) });
  assert.equal(sig.state, "fresh");
  assert.equal(sig.ageDays, 2);
  assert.equal(sig.sources, 1);
});

test("timeSignal — 3d, 1 source → fresh (inclusive boundary)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(3) });
  assert.equal(sig.state, "fresh");
});

test("timeSignal — 4d, 1 source → null, the deliberate no-chip band", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(4) });
  assert.equal(sig.state, null);
});

test("timeSignal — 2d, 3 sources → heating (corroboration beats fresh)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(2), corroborated_sources: ["a", "b", "c"] });
  assert.equal(sig.state, "heating");
});

test("timeSignal — 10d, 4 sources → heating (inclusive boundary)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(10), corroborated_sources: ["a", "b", "c", "d"] });
  assert.equal(sig.state, "heating");
});

test("timeSignal — 11d, 4 sources → cooling (age outranks corroboration)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(11), corroborated_sources: ["a", "b", "c", "d"] });
  assert.equal(sig.state, "cooling");
});

test("timeSignal — unparseable date → state null, ageDays null, never 0d", () => {
  const sig = timeSignal({ date: "not a date" });
  assert.equal(sig.state, null);
  assert.equal(sig.ageDays, null);
});

test("timeSignal — corroborated_sources absent → sources: 1", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const sig = timeSignal({ date: daysAgo(2) });
  assert.equal(sig.sources, 1);
});

test("buildReportHtml with top omitted renders today's output without throwing", () => {
  const html = buildReportHtml({
    brandName: "Brand",
    result: {
      pulse_summary: "summary",
      items: [{ headline: "Headline", source: "Src", url: "https://example.com/a", relevance: "direct", effort: "quick", why_now: "n", so_what: "s", payoff: "p" }],
    },
  });
  assert.ok(html.includes("Headline"));
  assert.ok(!html.includes("Fresh"));
  assert.ok(!html.includes("Heating"));
  assert.ok(!html.includes("Cooling"));
});

test("postLeadFailure and postLeadFallback set the correct action field", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true };
  };
  await postLeadFailure(fetchImpl, "https://script.example/exec", "shh", { email: "a@b.com", brandName: "B", errorCode: "SERVICE_ERROR" });
  await postLeadFallback(fetchImpl, "https://script.example/exec", "shh", { email: "a@b.com", brandName: "B", body: "fallback text" });
  assert.equal(calls[0].action, "lead_failure");
  assert.equal(calls[0].errorCode, "SERVICE_ERROR");
  assert.equal(calls[1].action, "lead_fallback");
  assert.equal(calls[1].emailBody, "fallback text");
});
