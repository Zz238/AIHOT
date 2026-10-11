CREATE TABLE IF NOT EXISTS market_source_runs (
  id text PRIMARY KEY, source_id text NOT NULL REFERENCES market_sources(source_id), trigger text NOT NULL, status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, fetched_urls jsonb NOT NULL DEFAULT '[]', parsed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0, duration_ms integer, error text, stage text NOT NULL DEFAULT 'collect'
);
