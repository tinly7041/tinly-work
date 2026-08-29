// netlify/functions/lib/lead-store.js
//
// Lead storage: builds the Sheet-write payload and posts it to Apps Script.
// Also handles the fallback email body constant and the post-confirmation
// failure alert POST.

export const FALLBACK_EMAIL_BODY =
  process.env.FALLBACK_EMAIL_BODY || "[FALLBACK COPY PENDING — DO NOT SHIP]";

export function buildLeadRow({
  name,
  email,
  role,
  company,
  brandName,
  website,
  category,
  confidence,
  directCount,
  reportSent,
  competitorsSource,
  competitorsList,
  quietCause,
}) {
  return {
    action: "lead",
    timestamp: new Date().toISOString(),
    name: name || "",
    email: email || "",
    whatsapp: "",
    telegram: "",
    role: role || "",
    company: company || "",
    brandName: brandName || "",
    website: website || "",
    category: category || "",
    confidence: confidence ?? "",
    directCount: directCount ?? "",
    reportSent: reportSent ? "Yes" : "No",
    competitors_source: competitorsSource || "",
    competitors_list: competitorsList || "",
    quiet_cause: quietCause || "",
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Builds the report's HTML body here — in Netlify, not in Apps Script — so
// the copy lives in exactly one place (same principle as
// FALLBACK_EMAIL_BODY below: Apps Script's job is only to relay/send what
// Netlify already produced, never to compose or reformat it).
export function buildReportHtml({ brandName, result }) {
  const items = result?.items || [];
  const summary = result?.pulse_summary || "";

  const itemsHtml = items
    .map(
      (it) => `
    <div style="margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid #e5e0d8;">
      <h3 style="font-family:sans-serif;font-size:18px;margin:0 0 4px;">${escapeHtml(it.headline)}</h3>
      <p style="font-family:sans-serif;font-size:12px;color:#6B6560;margin:0 0 12px;">
        ${escapeHtml(it.source || "")} ·
        <span style="text-transform:uppercase;">${escapeHtml(it.relevance || "")}</span> ·
        ${escapeHtml(it.effort || "")}
        ${it.url ? ` · <a href="${escapeHtml(it.url)}" style="color:#2C56E8;">source</a>` : ""}
      </p>
      <p style="font-family:sans-serif;font-size:14px;margin:0 0 8px;"><strong>Why now:</strong> ${escapeHtml(it.why_now || "")}</p>
      <p style="font-family:sans-serif;font-size:14px;margin:0 0 8px;"><strong>So what:</strong> ${escapeHtml(it.so_what || "")}</p>
      <p style="font-family:sans-serif;font-size:14px;margin:0;"><strong>Payoff:</strong> ${escapeHtml(it.payoff || "")}</p>
    </div>`
    )
    .join("\n");

  return `<div style="max-width:600px;margin:0 auto;font-family:sans-serif;color:#141414;">
  <h2 style="font-family:sans-serif;font-size:22px;margin:0 0 16px;">Your Trend Pulse — ${escapeHtml(brandName || "")}</h2>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${escapeHtml(summary)}</p>
  ${itemsHtml}
</div>`;
}

export async function postLead(fetchImpl, appsScriptUrl, appsScriptSecret, leadRow) {
  const res = await fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: appsScriptSecret, ...leadRow }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script lead POST responded ${res.status}`);
  }
  return res;
}

export async function postReport(fetchImpl, appsScriptUrl, appsScriptSecret, { email, brandName, reportHtml }) {
  const res = await fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: appsScriptSecret,
      action: "report",
      email,
      brandName,
      reportHtml,
    }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script report POST responded ${res.status}`);
  }
  return res;
}

export async function postLeadFailure(fetchImpl, appsScriptUrl, appsScriptSecret, { email, brandName, errorCode }) {
  const res = await fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: appsScriptSecret,
      action: "lead_failure",
      email,
      brandName,
      errorCode,
      timestamp: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script lead_failure POST responded ${res.status}`);
  }
  return res;
}

export async function postLeadFallback(fetchImpl, appsScriptUrl, appsScriptSecret, { email, brandName, body }) {
  const res = await fetchImpl(appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: appsScriptSecret,
      action: "lead_fallback",
      email,
      brandName,
      emailBody: body,
      timestamp: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Apps Script lead_fallback POST responded ${res.status}`);
  }
  return res;
}
