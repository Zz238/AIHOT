CREATE TABLE IF NOT EXISTS market_daily_prices (
  region_code text NOT NULL, product_id text NOT NULL REFERENCES market_products(product_id), price_type text NOT NULL, date date NOT NULL,
  min_price numeric, max_price numeric, reference_low numeric, reference_high numeric, median_price numeric,
  sample_count integer NOT NULL, independent_source_count integer NOT NULL, calculated_at timestamptz NOT NULL DEFAULT now(),
  data_quality text NOT NULL, input_version text NOT NULL, revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY(region_code, product_id, price_type, date)
);
