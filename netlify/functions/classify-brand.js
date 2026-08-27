// netlify/functions/classify-brand.js
//
// POST { brandName: string, website: string }
// -> 200 { primary, secondary, confidence, brand_read, site_read }
//
// Requires env var ANTHROPIC_API_KEY (set in Netlify site settings > Environment
// variables). Uses Claude Haiku — classification is a cheap/fast task. Fetches
// the site (title, meta description, og:*, body text excerpt) before
// classifying — see lib/classify.js for the fetch + prompt. Site-fetch failure
// is non-fatal (site_read: false); an Anthropic API failure fails open to a
// low-confidence default rather than breaking the caller.

import { classifyBrand } from "./lib/classify.js";
import { ACTIVE } from "./lib/categories.js";

export const handler = async (event) => {
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

  try {
    const { _usage, _model, ...result } = await classifyBrand({
      brandName,
      website,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error("classify-brand error:", err);
    // Fail open rather than breaking the caller.
    return {
      statusCode: 200,
      body: JSON.stringify({
        primary: ACTIVE[0],
        secondary: null,
        confidence: 0.1,
        brand_read: "Classification failed — no read available.",
        site_read: false,
        inferred_competitors: [],
      }),
    };
  }
};
