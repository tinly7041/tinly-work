// netlify/functions/generate-report-background.js
//
// Netlify background function (-background suffix is load-bearing).
// Runs post-gate (Pass 2, Sonnet) and delivers the report via Apps Script.
// On failure: retries per RETRYABLE taxonomy, then escalates to Tin alert
// and marks the pending-leads entry so the follow-up checker can send the
// lead-facing fallback.

import { getStore } from "@netlify/blobs";
import { refreshCompetitorEntity } from "./lib/competitor-fetch.js";
import { runPostGate } from "./lib/read-pulse.js";
import { buildLeadRow, postLead, postLeadFailure } from "./lib/lead-store.js";

const MAX_RETRIES = 2;
const RETRYABLE_ERRORS = ["Pass2ParseError", "ECONNRESET", "UND_ERR_SOCKET", "fetch failed"];

function isRetryable(err) {
  const msg = err?.message || "";
  return RETRYABLE_ERRORS.some((pat) => msg.includes(pat));
}

export default async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    console.error("[generate-report-bg] invalid JSON body");
    return new Response("invalid json", { status: 400 });
  }

  const {
    leadId, name, email, company, role,
    brandName, website, category, secondaryCategory, brandRead,
    confidence, competitors, competitorsSource, competitorsList,
    top, quiet_cause,
  } = body;

  const env = process.env;
  const pendingStore = getStore("pending-leads");

  // Refresh any not-yet-fresh competitor entities (force: false)
  for (const comp of (competitors || [])) {
    const compName = typeof comp === "string" ? comp : comp.name;
    try {
      await refreshCompetitorEntity(compName, category, { getStore, force: false });
    } catch (err) {
      console.error(`[generate-report-bg] competitor refresh failed for ${compName}: ${err.message}`);
    }
  }

  // Write lead row to Sheet
  try {
    const leadRow = buildLeadRow({
      name, email, role, company, brandName, website,
      category, confidence,
      directCount: (top || []).filter((s) => s.relevance === "direct").length,
      reportSent: false,
      competitorsSource: competitorsSource || "",
      competitorsList: competitorsList || "",
      quietCause: quiet_cause || "",
    });
    await postLead(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, leadRow);
  } catch (err) {
    console.error("[generate-report-bg] lead row write failed:", err.message);
  }

  // Run post-gate (Pass 2) with retries
  let postGate = null;
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      postGate = await runPostGate({
        top: top || [],
        brandName, website, brandRead,
        primaryCategory: category,
        secondaryCategory,
        competitors,
        fetchImpl: fetch,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
      });
      break;
    } catch (err) {
      lastError = err;
      console.error(`[generate-report-bg] Pass 2 attempt ${attempt + 1} failed: ${err.message}`);
      if (!isRetryable(err) || attempt === MAX_RETRIES) break;
    }
  }

  if (!postGate || postGate.result.quiet) {
    // Post-gate failed or produced a quiet result — alert Tin
    const errorCode = lastError ? "SERVICE_ERROR" : "POST_GATE_FAILURE";
    console.error(`[generate-report-bg] ${errorCode} for ${brandName} (${email})`);

    try {
      await postLeadFailure(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
        email, brandName, errorCode,
      });
      await pendingStore.setJSON(leadId, {
        ...(await pendingStore.get(leadId, { type: "json" }).catch(() => ({}))),
        alertSent: true,
      });
    } catch (err) {
      console.error("[generate-report-bg] failure alert failed:", err.message);
    }
    return new Response("failure handled", { status: 200 });
  }

  // Deliver the report via Apps Script
  try {
    await postLead(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
      action: "report",
      email,
      brandName,
      report: postGate.result,
    });

    await pendingStore.setJSON(leadId, {
      ...(await pendingStore.get(leadId, { type: "json" }).catch(() => ({}))),
      reportSent: true,
    });

    console.log(`[generate-report-bg] report delivered for ${brandName} (${email}): ${postGate.result.items.length} items — ${postGate.result.items.map((i) => `"${i.headline}"`).join(", ")}`);
  } catch (err) {
    console.error(`[generate-report-bg] report delivery failed for ${brandName}: ${err.message}`);
    try {
      await postLeadFailure(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
        email, brandName, errorCode: "DELIVERY_FAILED",
      });
      await pendingStore.setJSON(leadId, {
        ...(await pendingStore.get(leadId, { type: "json" }).catch(() => ({}))),
        alertSent: true,
      });
    } catch (alertErr) {
      console.error("[generate-report-bg] delivery failure alert also failed:", alertErr.message);
    }
  }

  return new Response("ok", { status: 200 });
};
