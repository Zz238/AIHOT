CREATE TABLE IF NOT EXISTS market_observations (
  id text PRIMARY KEY, source_id text NOT NULL REFERENCES market_sources(source_id), source_record_id text, product_id text REFERENCES market_products(product_id),
  product_name text NOT NULL, variant text NOT NULL DEFAULT '', region_code text NOT NULL, market_id text REFERENCES market_markets(market_id), market_name text,
  price_type text NOT NULL CHECK(price_type IN ('wholesale','retail','supermarket','user_report','unknown')),
  original_price numeric NOT NULL, original_unit text NOT NULL, normalized_price numeric, normalized_unit text,
  observed_at timestamptz, observation_date date, published_at timestamptz, collected_at timestamptz NOT NULL DEFAULT now(),
  source_url text NOT NULL, evidence_text text NOT NULL, raw_payload jsonb, raw_hash text NOT NULL,
  identity_key text NOT NULL UNIQUE, quote_key text NOT NULL, review_status text NOT NULL CHECK(review_status IN ('pending','verified','rejected')),
  quality_flags text[] NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, manual_override boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(normalized_price IS NULL OR normalized_price > 0),
  CHECK(review_status <> 'verified' OR (normalized_price > 0 AND product_id IS NOT NULL AND observation_date IS NOT NULL AND price_type <> 'unknown'))
);
