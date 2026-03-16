-- Enable uuid-ossp for deterministic UUIDs (e.g. extensions.uuid_generate_v5 in reconciliation idempotency).
-- Idempotent; no schema, data, RLS, or function changes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verification (expected one row: extname = 'uuid-ossp'):
-- SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp';
