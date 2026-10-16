CREATE TABLE IF NOT EXISTS market_regions (region_code text PRIMARY KEY CHECK (region_code ~ '^[0-9]{6}$'), name text NOT NULL, enabled boolean NOT NULL DEFAULT true);
