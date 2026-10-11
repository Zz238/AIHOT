import type {
  SourceInput,
  Product,
  MarketQuery,
  ReviewStatus,
} from "./backend/contracts.ts";
export type { SourceInput, Product, MarketQuery };
export interface SourceView extends SourceInput {
  last_success_at: string | null;
  next_fetch_at: string | null;
  last_error: string | null;
}
export interface ObservationView {
  id: string;
  product_name: string;
  variant: string;
  product_id: string | null;
  source_name: string;
  region_code: string;
  market_name: string | null;
  price_type: string;
  original_price: number;
  original_unit: string;
  normalized_price: number | null;
  normalized_unit: string | null;
  observed_at: string | null;
  published_at: string | null;
  collected_at: string;
  observation_date: string | null;
  evidence_text: string;
  source_url: string;
  raw_payload: unknown;
  quality_flags: string[];
  review_status: ReviewStatus;
  version: number;
}
export interface PriceView {
  product_id: string;
  name: string;
  variant: string;
  date: string;
  median_price: number | null;
  reference_low: number | null;
  reference_high: number | null;
  price: number | null;
  sample_count: number;
  independent_source_count: number;
  data_quality: string;
  freshness: string;
  revision: number;
  notice: string;
}
export interface PriceList {
  data: PriceView[];
  date: string;
  region_code: string;
  price_type: string;
  notice: string | null;
  page: number;
  has_more: boolean;
}
export interface BriefView {
  data: {
    text: string;
    metrics: unknown;
    generated_at: string;
    input_version: string;
    model_version: string;
  } | null;
  notice: string | null;
}
export interface OverviewView {
  date: string;
  sources: { active_sources: number; latest_success: string | null };
  observations: {
    collected_today: number;
    valid_today: number;
    pending: number;
    region_coverage: number;
  };
  runs: {
    failed_today: number;
    runs_today: number;
    total_duration_ms: number;
    fetched_pages: number;
  };
  costs: Array<{
    service: string;
    currency: string | null;
    cost_basis: string | null;
    calls: number;
    cost: number | null;
  }>;
  config: {
    collect_enabled: boolean;
    ai_review_enabled: boolean;
    model_calls_enabled: boolean;
    ingest_configured: boolean;
  };
}
export interface RunView {
  id: string;
  source_id: string;
  name: string;
  trigger: string;
  status: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  fetched_urls: string[];
  parsed_count: number;
  created_count: number;
  duration_ms: number | null;
  error: string | null;
  rejected_count: number;
  pending_count: number;
  revised_count: number;
  latest_validation: string | null;
}
export interface DocumentView {
  id: string;
  source_id: string;
  source_url: string;
  status: string;
  extracted_count: number;
  receipt_id: number | null;
  error: string | null;
  created_at: string;
}
export interface HistoryView {
  data: Array<
    Pick<
      PriceView,
      | "date"
      | "median_price"
      | "reference_low"
      | "reference_high"
      | "sample_count"
    >
  >;
  from: string;
  to: string;
  notice: string;
}
export interface DictionaryView {
  data: Product[];
  regions: Array<{ region_code: string; name: string; enabled: boolean }>;
  markets: Array<{
    market_id: string;
    name: string;
    region_code: string;
    price_type: string;
  }>;
  price_types: string[];
}
