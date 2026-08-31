// netlify/functions/lead-followup-check.js
//
// Scheduled function (*/10 * * * *). The only place that catches a
// background function silently killed by the 15-minute Netlify ceiling.
// Two independent time-based checks on the pending-leads store:
//
//   1. alertSent===false && elapsed > 15min → Tin alert (ceiling blown)
//   2. fallbackSent===false && elapsed >= 10min → lead-facing fallback email
//
// No automated retry of report delivery — per brief, explicitly not built.

import { getStore } from "@netlify/blobs";
import { FALLBACK_EMAIL_BODY, postLeadFailure, postLeadFallback } from "./lib/lead-store.js";

const ALERT_THRESHOLD_MS = 15 * 60 * 1000;
const FALLBACK_THRESHOLD_MS = 10 * 60 * 1000;

export default async () => {
  const store = getStore("pending-leads");
  const env = process.env;
  const now = Date.now();

  let entries;
  try {
    const { blobs } = await store.list();
    entries = blobs || [];
  } catch (err) {
    console.error("[lead-followup-check] failed to list pending-leads:", err.message);
    return new Response("list failed", { status: 200 });
  }

  let checked = 0;
  let alerts = 0;
  let fallbacks = 0;

  for (const blob of entries) {
    let lead;
    try {
      lead = await store.get(blob.key, { type: "json" });
    } catch {
      continue;
    }
    if (!lead || lead.reportSent) continue;

    const elapsed = now - Date.parse(lead.submittedAt);
    checked++;

    // Check 1: Tin alert for ceiling-blown background function
    if (!lead.alertSent && elapsed > ALERT_THRESHOLD_MS) {
      try {
        await postLeadFailure(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
          email: lead.email,
          brandName: lead.brandName,
          errorCode: "CEILING_BLOWN",
        });
        lead.alertSent = true;
        await store.setJSON(blob.key, lead);
        alerts++;
        console.log(`[lead-followup-check] Tin alert sent for ${lead.brandName} (${lead.email}) — ceiling blown`);
      } catch (err) {
        console.error(`[lead-followup-check] alert failed for ${lead.email}: ${err.message}`);
      }
    }

    // Check 2: lead-facing fallback email
    if (!lead.fallbackSent && elapsed >= FALLBACK_THRESHOLD_MS) {
      try {
        await postLeadFallback(fetch, env.APPS_SCRIPT_URL, env.APPS_SCRIPT_SECRET, {
          email: lead.email,
          brandName: lead.brandName,
          body: FALLBACK_EMAIL_BODY,
        });
        lead.fallbackSent = true;
        await store.setJSON(blob.key, lead);
        fallbacks++;
        console.log(`[lead-followup-check] fallback email sent for ${lead.brandName} (${lead.email})`);
      } catch (err) {
        console.error(`[lead-followup-check] fallback failed for ${lead.email}: ${err.message}`);
      }
    }
  }

  console.log(`[lead-followup-check] done: checked ${checked} pending leads, ${alerts} alerts, ${fallbacks} fallbacks`);
  return new Response(JSON.stringify({ checked, alerts, fallbacks }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { schedule: "*/10 * * * *" };
