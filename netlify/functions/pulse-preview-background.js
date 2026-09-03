// netlify/functions/pulse-preview-background.js
//
// Netlify background function (-background filename suffix is load-bearing
// — see competitor-fetch-background.js). Does the actual work State 1->2
// needs: brand classification, then Pass 1 scoring against the category
// pool — up to three sequential Anthropic calls that routinely exceed the
// ~30s ceiling on synchronous functions for a brand with no cached data.
// Background functions get a 15-minute window instead, no request-path
// timeout, response body discarded — the same trade generate-report-
// background.js already makes for Pass 2.
//
// Invoked fire-and-forget by pulse-preview.js once the fast abuse gates
// clear. Writes its result to the jobId entry in the pulse-preview-jobs
// Blobs store; pulse-preview-status.js reads it back for the client to poll.

import { getStore } from "@netlify/blobs";
import { classifyBrand } from "./lib/classify.js";
import { loadCategoryPool } from "./lib/pool.js";
import { getCachedEntity } from "./lib/entity-cache.js";
import { runPreGate, ACTION_STANDARDS } from "./lib/read-pulse.js";
import { classifyQuiet, hasCompetitorSignalInPool } from "./lib/quiet-taxonomy.js";

const JOB_STORE = "pulse-preview-jobs";
const MAX_STALE_HOURS = 60;

export default async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    console.error("[pulse-preview-bg] invalid JSON body");
    return new Response("invalid json", { status: 400 });
  }

  const { jobId, brandName, website } = body;
  if (!jobId) {
    console.error("[pulse-preview-bg] missing jobId in request body");
    return new Response("missing jobId", { status: 400 });
  }

  const jobStore = getStore(JOB_STORE);

  try {
    const classification = await classifyBrand({
      brandName,
      website,
      fetchImpl: fetch,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    const { primary: primaryCategory, secondary: secondaryCategory, brand_read: brandRead, confidence, inferred_competitors } = classification;

    if (!primaryCategory) {
      await jobStore.setJSON(jobId, {
        status: "done",
        result: { status: "unknown_brand", brand: brandName },
      });
      return new Response("ok", { status: 200 });
    }

    // Load category pools
    const primaryPool = await loadCategoryPool(primaryCategory, { getStore });
    const secondaryPool = secondaryCategory ? await loadCategoryPool(secondaryCategory, { getStore }) : null;

    // Pool health signals
    const poolAgeHours = primaryPool?.fetched_at ? (Date.now() - Date.parse(primaryPool.fetched_at)) / 3_600_000 : Infinity;
    const poolStale = poolAgeHours > MAX_STALE_HOURS;
    const poolThin = primaryPool?.health?.healthy === false;

    // Load competitor items from cache only
    const competitors = (inferred_competitors || []).map((name) => ({ name, source: "inferred" }));
    const competitorItems = [];
    for (const comp of competitors) {
      try {
        const cached = await getCachedEntity(comp.name, { getStore });
        if (cached?.items) {
          for (const item of cached.items) {
            competitorItems.push({ ...item, entity: comp.name });
          }
        }
      } catch {
        // Cache miss or error — degrade silently
      }
    }

    // Run pre-gate (Pass 1, Haiku)
    const preGate = await runPreGate({
      primaryPool,
      secondaryPool,
      competitorItems,
      brandName,
      website,
      brandRead,
      primaryCategory,
      secondaryCategory,
      competitors,
      fetchImpl: fetch,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Determine quiet cause
    const directCount = preGate.scored.filter((s) => s.relevance === "direct").length;
    const poolCompetitorHit = hasCompetitorSignalInPool(preGate.scored, competitors);
    const quietCause = classifyQuiet({
      poolThin,
      poolStale,
      competitorItemCount: competitorItems.length,
      poolCompetitorHit,
      direct: directCount,
      minDirect: ACTION_STANDARDS.minDirect,
    });

    // Build preview items (up to 2 titles for State 2 proof)
    const previewItems = preGate.top.slice(0, 2).map((s) => ({
      title: s.item.title,
      source: s.item.source,
      relevance: s.relevance,
    }));

    await jobStore.setJSON(jobId, {
      status: "done",
      result: {
        status: "ok",
        brand: brandName,
        website,
        category: primaryCategory,
        secondaryCategory,
        brandRead,
        confidence,
        competitors: competitors.map((c) => ({ name: c.name, source: c.source })),
        preGateItems: previewItems,
        quiet_cause: quietCause,
        top: preGate.top,
        debug: {
          pool_size: preGate.pool.length,
          competitor_item_count: competitorItems.length,
          pool_competitor_hit: poolCompetitorHit,
          pool_stale: poolStale,
          pool_thin: poolThin,
          pass1_cost: preGate.pass1Cost,
        },
      },
    });

    console.log(`[pulse-preview-bg] done for "${brandName}" (jobId ${jobId}): ${primaryCategory}${quietCause ? ", quiet: " + quietCause : ""}`);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(`[pulse-preview-bg] failed for "${brandName}" (jobId ${jobId}):`, err);
    try {
      await jobStore.setJSON(jobId, {
        status: "error",
        error: err.message || "unknown_error",
      });
    } catch (writeErr) {
      console.error(`[pulse-preview-bg] also failed to write error status for jobId ${jobId}:`, writeErr);
    }
    return new Response("error handled", { status: 200 });
  }
};
