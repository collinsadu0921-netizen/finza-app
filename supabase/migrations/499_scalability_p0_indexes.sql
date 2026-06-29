-- ============================================================================
-- P0 scalability indexes (audit remediation)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_business_users_user_id
  ON public.business_users (user_id);

CREATE INDEX IF NOT EXISTS idx_businesses_owner_id_active
  ON public.businesses (owner_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_business_date_desc
  ON public.expenses (business_id, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_business_date_desc
  ON public.payments (business_id, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_business_period
  ON public.journal_entries (business_id, period_id);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_business_month_status
  ON public.payroll_runs (business_id, payroll_month, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_entity_created
  ON public.audit_logs (business_id, entity_type, entity_id, created_at DESC);
