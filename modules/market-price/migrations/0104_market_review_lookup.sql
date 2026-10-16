CREATE INDEX CONCURRENTLY IF NOT EXISTS market_review_lookup ON market_observations(review_status,collected_at DESC);
