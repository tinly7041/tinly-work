// netlify/functions/classify-brand.js
//
// POST { brandName: string, website: string }
// -> 200 { category: string, confidence: "high"|"medium"|"low", reasoning: string }
//
// Requires env var ANTHROPIC_API_KEY (set in Netlify site settings > Environment variables)
// Uses Claude Haiku — classification is a cheap/fast task, no need for a bigger model.
// Lightly fetches the website (title + meta description only, 4s timeout) when provided —
// a bare URL string gives the classifier almost nothing for early-stage/unknown brands;
// actual page content does. Fetch failure is non-fatal — falls back to brand name alone.

const CATEGORIES = [
  "AI",
  "Web3 / Crypto",
  "FinTech",
  "B2B SaaS / DevTools",
  "Cybersecurity",
  "General Tech", // fallback — used when nothing else fits confidently
];

const SYSTEM_PROMPT = `You classify early-stage tech brands into exactly one category for a trend-monitoring tool. Categories and what belongs in each:

- AI: AI-native products, ML infra, AI agents/tools
- Web3 / Crypto: blockchain, DeFi, crypto exchanges, wallets, protocols, NFT/token projects
- FinTech: payments, banking infra, lending, financial SaaS (non-crypto)
- B2B SaaS / DevTools: developer tools, B2B software, cloud infra, internal tools
- Cybersecurity: security products, auditing, compliance tooling
- General Tech: use this ONLY when the brand doesn't clearly fit any category above, or when there isn't enough information to tell

Respond with ONLY a JSON object, no other text, no markdown fences:
{"category": "<one of the categories above, exact string>", "confidence": "high" | "medium" | "low", "reasoning": "<one short sentence>"}`;

async function fetchSiteSignal(url) {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // don't let a slow site block the request
    const res = await fetch(normalized, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; tinlywork-trendpulse/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
    const desc =
      (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [])[1] || "";
    if (!title && !desc) return null;
    return `Page title: ${title}\nMeta description: ${desc}`.trim();
  } catch {
    return null; // fetch failed or timed out — not fatal, just skip this signal
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let brandName, website;
  try {
    ({ brandName, website } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!brandName || !brandName.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "brandName is required" }) };
  }

  const siteSignal = website ? await fetchSiteSignal(website) : null;
  const userMessage = `Brand name: ${brandName}\n${
    website ? `Website: ${website}` : "No website provided."
  }${siteSignal ? `\n${siteSignal}` : ""}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    const raw = data.content?.find((b) => b.type === "text")?.text || "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!CATEGORIES.includes(parsed.category)) {
      parsed.category = "General Tech";
      parsed.confidence = "low";
    }

    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("classify-brand error:", err);
    // Fail open to General Tech rather than breaking the user's flow
    return {
      statusCode: 200,
      body: JSON.stringify({
        category: "General Tech",
        confidence: "low",
        reasoning: "Classification failed — defaulted to general tech pulse.",
      }),
    };
  }
};
