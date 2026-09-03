// netlify/functions/pulse-preview-status.js
//
// Polled by the client after pulse-preview.js hands back a jobId. Reads
// pulse-preview-background.js's result out of the pulse-preview-jobs Blobs
// store. GET ?id=<jobId> -> { status: "pending" | "done" | "error", ... }.
//
// no-store on every response: this is a GET endpoint polled repeatedly for
// a value that changes within seconds, and turnstile-config.js already
// taught this project what happens when a GET response has no explicit
// Cache-Control on Netlify's edge — a stale answer here would mean the
// client polls forever against a cached "pending".

import { getStore } from "@netlify/blobs";

const JOB_STORE = "pulse-preview-jobs";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const jobId = new URL(req.url).searchParams.get("id");
  if (!jobId) return json(400, { error: "missing_id" });

  const jobStore = getStore(JOB_STORE);
  const job = await jobStore.get(jobId, { type: "json" });

  if (!job) return json(404, { error: "not_found" });

  return json(200, job);
};
