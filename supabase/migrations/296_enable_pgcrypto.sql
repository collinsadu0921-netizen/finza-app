-- ============================================================================
-- MIGRATION: Enable pgcrypto extension for digest() (e.g. post_manual_journal_draft_to_ledger)
-- ============================================================================
-- Required for digest(text, 'sha256'). No other schema, RLS, or function changes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
