CREATE TABLE IF NOT EXISTS market_run_batches (
  run_id text NOT NULL REFERENCES market_source_runs(id),
  batch_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, batch_id)
);
