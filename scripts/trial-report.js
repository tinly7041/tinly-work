#!/usr/bin/env node
// Step 4 deliverable — 7-day trial log viewer. Reads the append-only
// "trial-log" key from the STAGING site's own (namespaced) Blobs store —
// never production's — and prints a day-by-day view plus a cross-day summary.
//
//   NETLIFY_AUTH_TOKEN=xxx NETLIFY_SITE_ID=xxx BLOBS_STORE_NAME=trends-staging \
//     node scripts/trial-report.js
//   node scripts/trial-report.js --json > trial-report.json

import { getStore } from "@netlify/blobs";

const JSON_OUT = process.argv.includes("--json");
const siteID = process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_AUTH_TOKEN;
const storeName = process.env.BLOBS_STORE_NAME || "trends-staging";

if (!siteID || !token) {
  console.error("Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (staging site's, not production's) to read the staging Blobs store.");
  process.exit(1);
}

const store = getStore({ name: storeName, siteID, token });
const log = (await store.get("trial-log", { type: "json" })) || [];

if (JSON_OUT) {
  console.log(JSON.stringify(log, null, 2));
  process.exit(0);
}

console.log(`Trial log: ${log.length} day(s) recorded, store "${storeName}"\n`);

for (const day of log) {
  console.log(`${"=".repeat(72)}\n${day.date}  (ran ${day.ran_at})\n${"=".repeat(72)}`);
  for (const c of day.categories) {
    if (c.error) {
      console.log(` ${c.category.padEnd(10)} FAILED — ${c.error}`);
      continue;
    }
    const h = c.health;
    console.log(
      ` ${c.category.padEnd(10)} ${h.healthy ? "OK      " : "DEGRADED"} cached:${String(h.total).padStart(3)} sources:${h.unique_sources} corroborated:${h.corroborated_items} median_age:${h.median_age_days}d`
    );
    if (c.failures?.length) console.log(`   failures: ${JSON.stringify(c.failures)}`);
    if (c.corroborated?.length) {
      console.log(`   corroborated items:`);
      c.corroborated.forEach((x) => console.log(`     - [${x.sources.join("+")}] ${x.title.slice(0, 60)}`));
    }
    for (const [src, stats] of Object.entries(c.per_source_score_stats || {})) {
      if (stats)
        console.log(
          `   ${src.padEnd(12)} score min/median/max: ${stats.min.toFixed(3)} / ${stats.median.toFixed(3)} / ${stats.max.toFixed(3)}`
        );
    }
  }
  console.log(
    ` x_list: fetched=${day.x_list?.fetched} rawCount=${day.x_list?.rawCount} spend=$${day.x_list?.estimatedSpendUSD}`
  );
}

console.log(`\n${"=".repeat(72)}\nSUMMARY ACROSS ${log.length} DAY(S)\n${"=".repeat(72)}`);
const byCat = {};
for (const day of log) {
  for (const c of day.categories) {
    (byCat[c.category] ||= []).push(c);
  }
}
for (const [cat, entries] of Object.entries(byCat)) {
  const healthyDays = entries.filter((e) => e.health?.healthy).length;
  const totalCorroborated = entries.reduce((sum, e) => sum + (e.health?.corroborated_items || 0), 0);
  console.log(
    ` ${cat.padEnd(10)} healthy ${healthyDays}/${entries.length} days | total corroborated items across trial: ${totalCorroborated}`
  );
}
const totalSpend = log.reduce((s, d) => s + (d.x_list?.estimatedSpendUSD || 0), 0);
console.log(` X List total spend across trial: $${totalSpend.toFixed(3)}`);
