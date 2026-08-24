// Per-1M-token USD pricing for models used in the Phase 2.5 read layer.
// Sonnet 5 is running intro pricing through 2026-08-31 (confirmed via the
// claude-api skill, cached 2026-06-24) — bump `claude-sonnet-5` to
// { input: 3.00, output: 15.00 } once that window closes.
export const MODEL_PRICING = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 }, // intro price through 2026-08-31
};

export function computeCost(usage, model) {
  if (!usage) return null;
  const rate = MODEL_PRICING[model];
  if (!rate) return null;
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const usd = (inputTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output;
  return { model, input_tokens: inputTokens, output_tokens: outputTokens, usd: Number(usd.toFixed(6)) };
}
