CREATE INDEX CONCURRENTLY IF NOT EXISTS market_documents_pending ON market_documents(status,created_at);
