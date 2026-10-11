CREATE INDEX CONCURRENTLY IF NOT EXISTS market_runs_lookup ON market_source_runs(source_id,started_at DESC);
