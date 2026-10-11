import { sha256, stableJson } from "@aihot/backend/lib/ids";
import type { Candidate, Product, Source, Validated } from "./contracts.ts";

export function normalizeUnit(value: number, unit: string, grams: number | null = null) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const clean = unit.toLowerCase().replace(/\s+/g, "").replace(/人民币|rmb|cny/g, "元").replace(/每/g, "/");
  if (/^(元\/?)?(斤|市斤|500g|500克)$/.test(clean)) return { price: value, unit: "元/斤" as const };
  if (/^(元\/?)?(kg|公斤|千克|1000g|1000克)$/.test(clean)) return { price: value / 2, unit: "元/斤" as const };
  if (/^(元\/?)?(盒|袋|把|个|份)$/.test(clean) && grams) return { price: value * 500 / grams, unit: "元/斤" as const };
  return null;
}

/** A plain Chinese date is midnight in Beijing; never read it in the host's timezone. */
export function observationTime(value: string | null): { instant: string; date: string } | null {
  if (!value) return null;
  const plain = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(value.trim());
  const input = plain ? `${plain[1]}-${plain[2].padStart(2, "0")}-${plain[3].padStart(2, "0")}T00:00:00+08:00` : value;
  if (!plain && !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  if (!plain) {
    const calendar = input.slice(0, 10);
    const day = new Date(`${calendar}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendar) return null;
  }
  const at = new Date(input);
  if (!Number.isFinite(at.getTime())) return null;
  const date = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (plain && date !== input.slice(0, 10)) return null;
  return { instant: at.toISOString(), date };
}

export function findProduct(candidate: Candidate, products: Product[]) {
  return products.find(p => (p.name === candidate.product_name || p.aliases.includes(candidate.product_name)) && p.variant === candidate.variant) ?? null;
}

export function validate(candidate: Candidate, source: Pick<Source, "source_id" | "publisher_key" | "trust_score">, products: Product[], opts: { now?: Date; previousPrice?: number | null; regionExists?: boolean; marketValid?: boolean } = {}): Validated {
  const flags: string[] = [];
  const product = findProduct(candidate, products);
  const normalized = normalizeUnit(candidate.price_value, candidate.price_unit, candidate.weight_grams);
  const observed = observationTime(candidate.observed_at);
  const now = opts.now ?? new Date();
  if (!product) flags.push("unknown_product_or_variant");
  if (!normalized) flags.push(candidate.price_value <= 0 ? "invalid_price" : "unconvertible_unit");
  if (!observed) flags.push("missing_or_invalid_observation_date");
  if (observed && new Date(observed.instant).getTime() > now.getTime() + 300000) flags.push("future_observation_date");
  if (observed && now.getTime() - new Date(observed.instant).getTime() > 7 * 86400000) flags.push("historical_reference");
  if (candidate.price_type === "unknown") flags.push("unknown_price_type");
  if (source.trust_score < 0.8) flags.push("low_source_trust");
  if (candidate.evidence_method !== "structured" || candidate.price_type === "user_report") flags.push("manual_evidence_review");
  if (opts.regionExists === false) flags.push("unknown_region");
  if (opts.marketValid === false) flags.push("unmapped_or_wrong_region_market");
  if (normalized && opts.previousPrice && Math.abs(normalized.price / opts.previousPrice - 1) > 0.5) flags.push("abnormal_price_change");
  const status = !normalized || flags.includes("future_observation_date") ? "rejected" : flags.some(f => f !== "historical_reference") ? "pending" : "verified";
  const scope = [product?.product_id ?? candidate.product_name, candidate.variant, candidate.region_code, candidate.market_id ?? candidate.market_name, candidate.price_type, observed?.date ?? candidate.observed_at];
  const record = candidate.source_record_id ?? candidate.source_url;
  return { candidate, product_id: product?.product_id ?? null, normalized_price: normalized?.price ?? null, normalized_unit: normalized?.unit ?? null,
    observed_at: observed?.instant ?? null, observation_date: observed?.date ?? null, review_status: status, quality_flags: flags,
    identity_key: sha256(stableJson([source.source_id, record, ...scope])), quote_key: sha256(stableJson([source.publisher_key, record, ...scope])), raw_hash: sha256(stableJson(candidate)),
  };
}
