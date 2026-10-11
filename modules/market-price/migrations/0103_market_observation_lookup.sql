CREATE INDEX CONCURRENTLY IF NOT EXISTS market_observation_lookup ON market_observations(region_code,product_id,price_type,observation_date,review_status);
