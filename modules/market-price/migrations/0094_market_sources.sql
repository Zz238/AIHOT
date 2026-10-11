CREATE TABLE IF NOT EXISTS market_sources (
  source_id text PRIMARY KEY, name text NOT NULL, type text NOT NULL CHECK(type IN ('json_api','html_table','rss_article','external','user_report')),
  url text, region_code text NOT NULL REFERENCES market_regions(region_code), market_id text REFERENCES market_markets(market_id),
  price_type text NOT NULL CHECK(price_type IN ('wholesale','retail','supermarket','user_report','unknown')), publisher_key text NOT NULL,
  trust_score numeric NOT NULL DEFAULT 0.5 CHECK(trust_score BETWEEN 0 AND 1), interval_minutes integer NOT NULL DEFAULT 120 CHECK(interval_minutes BETWEEN 15 AND 10080),
  enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}', last_success_at timestamptz, next_fetch_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
