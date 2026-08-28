// netlify/functions/lead-submit.js
//
// State 3 contact-gate POST. Validates the 4 required fields, writes a
// pending-leads Blobs entry (for the follow-up checker), fires the
// background report generation, and responds 200 immediately so the
// client can show State 4.

import { getStore } from "@netlify/blobs";

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

  // Fire background report generation
  const baseUrl = process.env.URL || "http://localhost:8888";
  try {
    await fetch(`${baseUrl}/.netlify/functions/generate-report-background`, {
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
  } catch (err) {
    console.error("[lead-submit] failed to invoke background function:", err);
  }

  return json(200, { status: "ok", leadId });
};
