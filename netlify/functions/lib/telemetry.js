// netlify/functions/lib/telemetry.js
//
// Step 7: "This contamination survived four sessions because nobody could
// see what the filters were doing. Without telemetry the next one will
// too." A plain counter bag, one per category per crawl, threaded through
// collect.js and the adapters so every drop — exclusion term, numeric gate,
// qualifying-signal filter, source-share cap — is visible afterward instead
// of silently vanishing.

export function createTelemetry() {
  return {
    exclusions: {}, // term -> count, aggregated across every source
    numeric_gates: {}, // source -> { gateName -> count }
    qualifying_signal: {}, // reason -> count
    source_share_cap: {}, // source -> count dropped by the 40% cache-share cap
  };
}

export function recordExclusion(t, term) {
  t.exclusions[term] = (t.exclusions[term] || 0) + 1;
}

export function recordNumericGate(t, source, gate) {
  (t.numeric_gates[source] ||= {});
  t.numeric_gates[source][gate] = (t.numeric_gates[source][gate] || 0) + 1;
}

export function recordQualifyingDrop(t, reason) {
  t.qualifying_signal[reason] = (t.qualifying_signal[reason] || 0) + 1;
}

export function recordShareCapDrop(t, source) {
  t.source_share_cap[source] = (t.source_share_cap[source] || 0) + 1;
}
