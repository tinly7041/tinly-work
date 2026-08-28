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
