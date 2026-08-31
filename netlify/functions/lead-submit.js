// netlify/functions/lead-submit.js
//
// State 3 contact-gate POST. Validates the required fields, writes the lead
// row to the Sheet SYNCHRONOUSLY (so a submission is captured even if the
// background invoke below never fires — a network error on that
// fire-and-forget fetch must not lose the lead), writes a pending-leads
// Blobs entry (for the follow-up checker), fires the background report
// generation, and responds 200 immediately so the client can show State 4.

import { getStore } from "@netlify/blobs";
import { buildLeadRow, postLead } from "./lib/lead-store.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const { name, email, company, role } = body;
  if (!email) {
    return json(400, { error: "missing_required_fields", detail: "email is required" });
  }

  const leadId = `${Date.now()}-${email.replace(/[^a-z0-9]/gi, "_").slice(0, 30)}`;
  const directCount = Array.isArray(body.top) ? body.top.filter((s) => s.relevance === "direct").length : "";

  // Write the lead row now, not from the background function — this is the
  // only guaranteed-synchronous point in the flow.
  try {
    const leadRow = buildLeadRow({
      name, email, role, company,
      brandName: body.brandName,
      website: body.website,
      category: body.category,
      confidence: body.confidence,
      directCount,
      reportSent: false,
      competitorsSource: body.competitorsSource,
      competitorsList: body.competitorsList,
      quietCause: body.quiet_cause,
    });
    await postLead(fetch, process.env.APPS_SCRIPT_URL, process.env.APPS_SCRIPT_SECRET, leadRow);
  } catch (err) {
    console.error("[lead-submit] lead row write failed:", err.message);
  }

  // Write pending-leads entry for the follow-up checker
  try {
    const store = getStore("pending-leads");
    await store.setJSON(leadId, {
      submittedAt: new Date().toISOString(),
      email,
      brandName: body.brandName,
      reportSent: false,
      alertSent: false,
      fallbackSent: false,
    });
  } catch (err) {
    console.error("[lead-submit] failed to write pending-leads entry:", err);
  }

  // Fire background report generation.
  //
  // Deliberately NOT process.env.URL (or DEPLOY_PRIME_URL/DEPLOY_URL/etc) —
  // every one of Netlify's self-referencing URL env vars is populated by
  // Netlify's BUILD process, and this site is deployed via a manual CLI
  // `netlify deploy --dir` upload, which skips the build step entirely.
  // Live-confirmed, Session 10: on this branch, process.env.URL is set (to
  // the PRODUCTION domain, always — that one env var is an exception, baked
  // into the runtime regardless of build) but DEPLOY_URL/DEPLOY_PRIME_URL/
  // CONTEXT/BRANCH are all simply absent. The first version of this fix
  // used DEPLOY_PRIME_URL as a fallback-safe choice per Netlify's docs, and
  // it silently fell straight through to the same broken production URL —
  // generate-report-background.js only exists on this branch, so that 404s,
  // and fetch() doesn't throw on a 404. An Avis lead wrote its row and
  // captured its email, then sat at reportSent: false forever with zero
  // trace anywhere.
  //
  // The actually-reliable source: the incoming request's own URL. It's
  // always correct — whatever hostname the browser used to reach THIS
  // function is exactly where its sibling functions live too — and it has
  // no dependency on which deploy mechanism Netlify used.
  const baseUrl = new URL(req.url).origin;
  try {
    const bgRes = await fetch(`${baseUrl}/.netlify/functions/generate-report-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        name,
        email,
        company,
        role,
        brandName: body.brandName,
        website: body.website,
        category: body.category,
        secondaryCategory: body.secondaryCategory,
        brandRead: body.brandRead,
        confidence: body.confidence,
        competitors: body.competitors,
        competitorsSource: body.competitorsSource,
        competitorsList: body.competitorsList,
        top: body.top,
        quiet_cause: body.quiet_cause,
      }),
    });
    // fetch() does not throw on a non-2xx response (this is exactly how the
    // DEPLOY_PRIME_URL bug above went undetected — a 404 looked identical to
    // success). Log it loud enough to actually be seen next time.
    if (!bgRes.ok) {
      console.error(
        `[lead-submit] background function invoke returned ${bgRes.status} for ${baseUrl} — report will not generate for leadId ${leadId}`
      );
    }
  } catch (err) {
    console.error("[lead-submit] failed to invoke background function:", err);
  }

  return json(200, { status: "ok", leadId });
};
