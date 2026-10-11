import { sha256, stableJson } from "@aihot/backend/lib/ids";

export interface Sample { id: string; normalized_price: number; quote_key: string; publisher_key: string; version: number }
const percentile = (values: number[], p: number) => {
  const i = (values.length - 1) * p; const low = Math.floor(i); const high = Math.ceil(i);
  return Math.round((values[low] + (values[high] - values[low]) * (i - low)) * 10000) / 10000;
};
export function summarize(samples: Sample[]) {
  const unique = [...new Map(samples.map(s => [s.quote_key, s])).values()];
  const values = unique.map(s => Number(s.normalized_price)).filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b);
  const sources = new Set(unique.map(s => s.publisher_key)).size;
  const sufficient = values.length >= 3 && sources >= 2;
  return { min_price: values[0] ?? null, max_price: values.at(-1) ?? null, median_price: values.length ? percentile(values, .5) : null,
    reference_low: sufficient ? percentile(values, .2) : null, reference_high: sufficient ? percentile(values, .8) : null,
    sample_count: values.length, independent_source_count: sources,
    data_quality: !values.length ? "no_data" : sources === 1 ? "single_source" : sufficient ? "sufficient" : "insufficient_samples",
    input_version: sha256(stableJson(unique.map(s => [s.id, s.version]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))),
  };
}
