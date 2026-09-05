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

// ---------- time-sensitivity signal ----------
//
// Derived entirely from the retrieval record (`item.date`,
// `item.corroborated_sources`), joined back to Pass 2's output by url —
// the same mechanism read-pulse.js already uses for
// enforceRelevanceDowngradeOnly. The model never authors these values.
//
// The rule is total and mutually exclusive. Precedence is deliberate:
// age outranks corroboration, so a heavily-corroborated 12-day story is
// still Cooling. An item with one mention and 4-10 days of age gets NO
// chip — it has no time story, and a chip that always appears stops
// carrying information.

const FRESH_MAX_DAYS = 3;
const COOLING_MIN_DAYS = 10; // exclusive: > 10d is cooling

export function timeSignal(item) {
  if (!item) return { state: null, ageDays: null, sources: 1 };

  const ms = Date.parse(item.date);
  const ageDays = Number.isFinite(ms)
    ? Math.max(0, Math.floor((Date.now() - ms) / 864e5))
    : null;
  const sources = item.corroborated_sources?.length ?? 1;

  let state = null;
  if (ageDays === null) state = null;              // unparseable date -> no chip, never "0d"
  else if (ageDays > COOLING_MIN_DAYS) state = "cooling";
  else if (sources >= 2) state = "heating";
  else if (ageDays <= FRESH_MAX_DAYS) state = "fresh";

  return { state, ageDays, sources };
}

// Solid fills, not CSS gradients — Outlook strips gradients and Gmail is
// unreliable on them. The amber -> orange -> red progression is carried by
// three discrete tiers keyed to source count, which renders everywhere.
function chipStyle(state, sources) {
  const base =
    "display:inline-block;padding:2px 8px;border-radius:10px;" +
    "font-family:sans-serif;font-size:11px;font-weight:600;" +
    "letter-spacing:0.02em;line-height:1.6;";

  if (state === "fresh") return base + "background:#E6F7FA;color:#0B6E7F;";
  if (state === "cooling") return base + "background:#EFEDE9;color:#6B6560;";
  if (state === "heating") {
    if (sources >= 4) return base + "background:#FEE2E2;color:#B91C1C;"; // red
    if (sources === 3) return base + "background:#FFEDD5;color:#C2410C;"; // orange
    return base + "background:#FEF3C7;color:#B45309;";                    // amber
  }
  return base + "background:#EFEDE9;color:#6B6560;";
}

// Static glyph, not animation — Gmail strips @keyframes.
const CHIP_LABEL = {
  fresh: "● Fresh",
  heating: "Heating",
  cooling: "Cooling",
};

function renderTimeChip(sig) {
  if (!sig?.state) return "";
  return `<span style="${chipStyle(sig.state, sig.sources)}">${CHIP_LABEL[sig.state]}</span>`;
}

// The facts sit next to the label so the label is auditable — a reader who
// doubts "Heating" can see the source count and age that produced it.
function renderTimeFacts(sig) {
  const parts = [];
  if (sig?.sources >= 2) parts.push(`${sig.sources} sources`);
  if (sig?.ageDays !== null && sig?.ageDays !== undefined) {
    parts.push(sig.ageDays === 0 ? "today" : `${sig.ageDays}d`);
  }
  return parts.join(" · ");
}

const NEUTRAL_CHIP =
  "display:inline-block;padding:2px 8px;border-radius:10px;" +
  "font-family:sans-serif;font-size:11px;font-weight:600;" +
  "letter-spacing:0.02em;line-height:1.6;background:#EEF2FE;color:#2C56E8;";

// Builds the report's HTML body here — in Netlify, not in Apps Script — so
// the copy lives in exactly one place (same principle as
// FALLBACK_EMAIL_BODY below: Apps Script's job is only to relay/send what
// Netlify already produced, never to compose or reformat it).
export function buildReportHtml({ brandName, result, top = [] }) {
  const items = result?.items || [];
  const summary = result?.pulse_summary || "";

  // Same url-keyed join read-pulse.js uses. `top` entries are {item, ...score}.
  const poolByUrl = new Map(
    (top || []).map((s) => [s?.item?.url, s?.item]).filter(([k]) => k)
  );

  const itemsHtml = items
    .map((it) => {
      const sig = timeSignal(poolByUrl.get(it.url));
      const timeChip = renderTimeChip(sig);
      const facts = renderTimeFacts(sig);

      const chips = [
        timeChip,
        it.relevance
          ? `<span style="${NEUTRAL_CHIP}">${escapeHtml(String(it.relevance).toUpperCase())}</span>`
          : "",
        it.effort
          ? `<span style="${NEUTRAL_CHIP}">${escapeHtml(it.effort)}</span>`
          : "",
      ]
        .filter(Boolean)
        .join("&nbsp;");

      const meta = [escapeHtml(it.source || ""), facts]
        .filter(Boolean)
        .join(" · ");

      return `
    <div style="margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid #e5e0d8;">
      <div style="margin:0 0 8px;">${chips}</div>
      <h3 style="font-family:sans-serif;font-size:18px;margin:0 0 4px;">${escapeHtml(it.headline)}</h3>
      <p style="font-family:sans-serif;font-size:12px;color:#6B6560;margin:0 0 12px;">
        ${meta}${it.url ? ` · <a href="${escapeHtml(it.url)}" style="color:#2C56E8;">source</a>` : ""}
      </p>
      <p style="font-family:sans-serif;font-size:14px;margin:0 0 8px;"><strong>Why now:</strong> ${escapeHtml(it.why_now || "")}</p>
      <p style="font-family:sans-serif;font-size:14px;margin:0 0 8px;"><strong>So what:</strong> ${escapeHtml(it.so_what || "")}</p>
      <p style="font-family:sans-serif;font-size:14px;margin:0;"><strong>Payoff:</strong> ${escapeHtml(it.payoff || "")}</p>
    </div>`;
    })
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
