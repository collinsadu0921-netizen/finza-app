-- ============================================================================
-- Migration 611: Paystack payroll disbursements (Phase 2)
-- ============================================================================
-- Tenant-owned Paystack accounts, employee recipient references, transfer
-- attempts, verified webhook events and controlled settlement/reversal.
--
-- Accounting rules preserved:
--   successful transfer: Dr 2240 Net Salaries Payable / Cr Paystack clearing
--   provider fee:        Dr Payment processing fees / Cr Paystack clearing
--   reversal:            Dr Paystack clearing / Cr 2240 Net Salaries Payable
--
-- No funding journal is invented from an API balance lookup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tenant Paystack payroll connection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_paystack_payroll_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  secret_key_encrypted TEXT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  validation_status TEXT NOT NULL DEFAULT 'validated',
  validated_at TIMESTAMPTZ NULL,
  last_balance_pesewas BIGINT NULL,
  last_balance_checked_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  clearing_account_id UUID NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  fee_account_id UUID NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_paystack_payroll_accounts_environment_check
    CHECK (environment IN ('test', 'live')),
  CONSTRAINT business_paystack_payroll_accounts_status_check
    CHECK (status IN ('connected', 'disconnected', 'error')),
  CONSTRAINT business_paystack_payroll_accounts_validation_check
    CHECK (validation_status IN ('validated', 'invalid', 'unvalidated'))
);

CREATE INDEX IF NOT EXISTS idx_business_paystack_payroll_accounts_business
  ON public.business_paystack_payroll_accounts(business_id)
  WHERE is_active = TRUE;

ALTER TABLE public.business_paystack_payroll_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paystack_payroll_accounts_select"
  ON public.business_paystack_payroll_accounts;
CREATE POLICY "paystack_payroll_accounts_select"
  ON public.business_paystack_payroll_accounts FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'settings.view')
      OR public.finza_user_has_permission(business_id, 'settings.edit')
    )
  );

DROP POLICY IF EXISTS "paystack_payroll_accounts_insert"
  ON public.business_paystack_payroll_accounts;
CREATE POLICY "paystack_payroll_accounts_insert"
  ON public.business_paystack_payroll_accounts FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'settings.edit')
  );

DROP POLICY IF EXISTS "paystack_payroll_accounts_update"
  ON public.business_paystack_payroll_accounts;
CREATE POLICY "paystack_payroll_accounts_update"
  ON public.business_paystack_payroll_accounts FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'settings.edit')
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'settings.edit')
  );

DROP POLICY IF EXISTS "paystack_payroll_accounts_delete"
  ON public.business_paystack_payroll_accounts;
CREATE POLICY "paystack_payroll_accounts_delete"
  ON public.business_paystack_payroll_accounts FOR DELETE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'settings.edit')
  );

DROP TRIGGER IF EXISTS update_business_paystack_payroll_accounts_updated_at
  ON public.business_paystack_payroll_accounts;
CREATE TRIGGER update_business_paystack_payroll_accounts_updated_at
  BEFORE UPDATE ON public.business_paystack_payroll_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.business_paystack_payroll_accounts IS
  'Tenant-owned Paystack account used only for payroll salary transfers. Finza subscription Paystack keys are never used here.';

-- ---------------------------------------------------------------------------
-- 2) Employee Paystack recipient association
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_payment_methods
  ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS paystack_recipient_environment TEXT NULL,
  ADD COLUMN IF NOT EXISTS paystack_recipient_fingerprint TEXT NULL,
  ADD COLUMN IF NOT EXISTS paystack_recipient_created_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_payment_methods_paystack_recipient_env_check'
      AND conrelid = 'public.staff_payment_methods'::regclass
  ) THEN
    ALTER TABLE public.staff_payment_methods
      ADD CONSTRAINT staff_payment_methods_paystack_recipient_env_check
      CHECK (
        paystack_recipient_environment IS NULL
        OR paystack_recipient_environment IN ('test', 'live')
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_staff_payment_methods_paystack_recipient
  ON public.staff_payment_methods(paystack_recipient_code)
  WHERE paystack_recipient_code IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.staff_payment_methods.paystack_recipient_code IS
  'Tenant-owned Paystack recipient code created from the frozen payout destination.';
COMMENT ON COLUMN public.staff_payment_methods.paystack_recipient_fingerprint IS
  'SHA-256 fingerprint of the destination details used for the recipient code.';

-- ---------------------------------------------------------------------------
-- 3) Transfer attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_paystack_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.payroll_payment_batches(id) ON DELETE CASCADE,
  batch_item_id UUID NOT NULL REFERENCES public.payroll_payment_batch_items(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  payroll_entry_id UUID NOT NULL REFERENCES public.payroll_entries(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'GHS',
  environment TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  recipient_code TEXT NULL,
  recipient_fingerprint TEXT NULL,
  destination_method_type TEXT NOT NULL,
  destination_provider_name TEXT NULL,
  destination_bank_name TEXT NULL,
  destination_bank_code TEXT NULL,
  destination_account_number TEXT NULL,
  destination_account_name TEXT NULL,
  destination_momo_provider TEXT NULL,
  destination_momo_number TEXT NULL,
  status TEXT NOT NULL DEFAULT 'initiating',
  provider_status TEXT NULL,
  provider_transfer_id TEXT NULL,
  provider_transfer_code TEXT NULL,
  provider_reference TEXT NULL,
  fee_amount NUMERIC(14,2) NULL,
  fee_journal_id UUID NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  fee_reversal_journal_id UUID NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  payment_id UUID NULL REFERENCES public.payroll_payments(id) ON DELETE RESTRICT,
  settlement_journal_id UUID NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_id UUID NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  failure_reason TEXT NULL,
  requires_attention_reason TEXT NULL,
  initiated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NULL,
  reversed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_paystack_transfers_amount_precision_check
    CHECK (amount = ROUND(amount, 2)),
  CONSTRAINT payroll_paystack_transfers_currency_check
    CHECK (currency = 'GHS'),
  CONSTRAINT payroll_paystack_transfers_environment_check
    CHECK (environment IN ('test', 'live')),
  CONSTRAINT payroll_paystack_transfers_status_check
    CHECK (
      status IN (
        'initiating',
        'awaiting_authorization',
        'pending',
        'successful',
        'failed',
        'reversed',
        'requires_attention',
        'cancelled'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_paystack_transfers_active_item
  ON public.payroll_paystack_transfers(batch_item_id)
  WHERE status IN ('initiating', 'awaiting_authorization', 'pending', 'successful');

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_paystack_transfers_business_idempotency
  ON public.payroll_paystack_transfers(business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_payroll_paystack_transfers_business_status
  ON public.payroll_paystack_transfers(business_id, status);

CREATE INDEX IF NOT EXISTS idx_payroll_paystack_transfers_run
  ON public.payroll_paystack_transfers(payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_payroll_paystack_transfers_reference
  ON public.payroll_paystack_transfers(reference);

ALTER TABLE public.payroll_paystack_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_paystack_transfers_select"
  ON public.payroll_paystack_transfers;
CREATE POLICY "payroll_paystack_transfers_select"
  ON public.payroll_paystack_transfers FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'payroll.view')
      OR public.finza_user_has_permission(business_id, 'payroll.pay')
    )
  );

-- Writes intentionally occur only through the server-side API using the
-- service role and the controlled settlement RPCs below.

DROP TRIGGER IF EXISTS update_payroll_paystack_transfers_updated_at
  ON public.payroll_paystack_transfers;
CREATE TRIGGER update_payroll_paystack_transfers_updated_at
  BEFORE UPDATE ON public.payroll_paystack_transfers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.payroll_paystack_transfers IS
  'Frozen Paystack salary transfer attempts. HTTP 200 initiation never equals salary settlement; only verified success does.';

-- ---------------------------------------------------------------------------
-- 4) Webhook audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_paystack_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NULL REFERENCES public.businesses(id) ON DELETE SET NULL,
  transfer_id UUID NULL REFERENCES public.payroll_paystack_transfers(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  reference TEXT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  processed_at TIMESTAMPTZ NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_paystack_webhook_events_processing_check
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_paystack_webhook_events_reference
  ON public.payroll_paystack_webhook_events(reference);

ALTER TABLE public.payroll_paystack_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payroll_paystack_webhook_events IS
  'Verified Paystack transfer webhook events, including duplicates and out-of-order deliveries, for audit.';

-- ---------------------------------------------------------------------------
-- 5) Unique fee / fee-reversal journals
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_one_paystack_transfer_fee
  ON public.journal_entries(business_id, reference_id)
  WHERE reference_type = 'paystack_transfer_fee' AND reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_one_paystack_transfer_fee_reversal
  ON public.journal_entries(business_id, reference_id)
  WHERE reference_type = 'paystack_transfer_fee_reversal' AND reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6) Settlement RPC (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_payroll_paystack_transfer_atomic(
  p_transfer_id UUID,
  p_provider_status TEXT,
  p_provider_transfer_id TEXT,
  p_provider_transfer_code TEXT,
  p_paid_at TIMESTAMPTZ,
  p_fee_pesewas BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_transfer public.payroll_paystack_transfers%ROWTYPE;
  v_connection public.business_paystack_payroll_accounts%ROWTYPE;
  v_run public.payroll_runs%ROWTYPE;
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_obligation public.payroll_obligations%ROWTYPE;
  v_existing public.payroll_payments%ROWTYPE;
  v_payment_id UUID;
  v_journal_id UUID;
  v_obligation_payment_id UUID;
  v_payment_date DATE;
  v_amount NUMERIC(14,2);
  v_key TEXT;
  v_scope TEXT := 'paystack_transfer';
  v_fingerprint TEXT;
  v_key_hash TEXT;
  v_paid_total NUMERIC := 0;
  v_latest_payment RECORD;
  v_fee_amount NUMERIC(14,2);
  v_fee_journal_id UUID;
  v_batch_status TEXT;
  v_existing_paid NUMERIC := 0;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  IF p_transfer_id IS NULL THEN
    RAISE EXCEPTION 'PAYSTACK_TRANSFER_INVALID_INPUT: transfer id is required';
  END IF;

  SELECT * INTO v_transfer
  FROM public.payroll_paystack_transfers t
  WHERE t.id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_TRANSFER_NOT_FOUND: transfer attempt not found';
  END IF;

  IF v_transfer.status = 'successful' AND v_transfer.payment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reused', TRUE,
      'transfer_id', v_transfer.id,
      'payment_id', v_transfer.payment_id,
      'journal_entry_id', v_transfer.settlement_journal_id,
      'fee_journal_id', v_transfer.fee_journal_id
    );
  END IF;

  IF v_transfer.status IN ('failed', 'reversed', 'cancelled') THEN
    RAISE EXCEPTION 'PAYSTACK_TRANSFER_STATE_CONFLICT: transfer is % and cannot be settled', v_transfer.status;
  END IF;

  IF upper(COALESCE(p_provider_status, '')) <> 'SUCCESS' THEN
    RAISE EXCEPTION 'PAYSTACK_TRANSFER_NOT_SUCCESSFUL: provider status % is not successful', p_provider_status;
  END IF;

  SELECT * INTO v_connection
  FROM public.business_paystack_payroll_accounts c
  WHERE c.business_id = v_transfer.business_id
  FOR SHARE;

  IF NOT FOUND OR v_connection.is_active IS NOT TRUE OR v_connection.status <> 'connected' THEN
    RAISE EXCEPTION 'PAYSTACK_CONNECTION_INACTIVE: tenant Paystack connection is not active';
  END IF;

  IF v_connection.environment IS DISTINCT FROM v_transfer.environment THEN
    RAISE EXCEPTION 'PAYSTACK_ENVIRONMENT_MISMATCH: transfer environment does not match the active connection';
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = v_transfer.payroll_run_id
    AND pr.business_id = v_transfer.business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_run.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'PAYSTACK_PAYROLL_NOT_PAYABLE: payroll run is no longer approved or locked';
  END IF;

  SELECT * INTO v_batch
  FROM public.payroll_payment_batches b
  WHERE b.id = v_transfer.batch_id
    AND b.business_id = v_transfer.business_id
    AND b.payroll_run_id = v_transfer.payroll_run_id
    AND b.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_batch.status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYSTACK_BATCH_NOT_PAYABLE: payment batch is missing or cancelled';
  END IF;

  SELECT * INTO v_item
  FROM public.payroll_payment_batch_items i
  WHERE i.id = v_transfer.batch_item_id
    AND i.batch_id = v_transfer.batch_id
    AND i.business_id = v_transfer.business_id
    AND i.payroll_run_id = v_transfer.payroll_run_id
    AND i.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_BATCH_ITEM_NOT_FOUND: payment batch item not found';
  END IF;

  IF v_item.status = 'paid' OR v_item.payroll_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'PAYSTACK_PAYMENT_ALREADY_SETTLED: batch item is already paid';
  END IF;

  IF v_item.status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'PAYSTACK_BATCH_ITEM_NOT_PAYABLE: batch item status % is not payable', v_item.status;
  END IF;

  IF ROUND(COALESCE(v_item.amount, 0), 2) IS DISTINCT FROM ROUND(v_transfer.amount, 2) THEN
    RAISE EXCEPTION 'PAYSTACK_AMOUNT_MISMATCH: transfer amount does not match the frozen batch item amount';
  END IF;

  IF v_transfer.currency <> 'GHS' OR v_item.currency <> 'GHS' THEN
    RAISE EXCEPTION 'PAYSTACK_CURRENCY_MISMATCH: only GHS salary transfers are supported';
  END IF;

  IF public.payroll_run_has_unallocated_aggregate_payments(v_transfer.business_id, v_transfer.payroll_run_id) THEN
    RAISE EXCEPTION 'PAYSTACK_AGGREGATE_RECONCILIATION_REQUIRED: run has unallocated aggregate salary payments';
  END IF;

  IF v_connection.clearing_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = v_connection.clearing_account_id
      AND a.business_id = v_transfer.business_id
      AND a.type = 'asset'
      AND a.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PAYSTACK_CLEARING_ACCOUNT_MISSING: Paystack clearing asset account is missing';
  END IF;

  SELECT COALESCE(SUM(pp.amount), 0)
  INTO v_existing_paid
  FROM public.payroll_payments pp
  WHERE pp.business_id = v_transfer.business_id
    AND pp.payroll_run_id = v_transfer.payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
    AND pp.reversed_at IS NULL;

  IF ROUND(v_existing_paid + v_transfer.amount, 2) > ROUND(COALESCE(v_run.total_net_salary, 0), 2) + 0.01 THEN
    RAISE EXCEPTION 'PAYSTACK_OVERPAYMENT_BLOCKED: transfer would exceed the run net salary payable';
  END IF;

  SELECT * INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.business_id = v_transfer.business_id
    AND po.payroll_run_id = v_transfer.payroll_run_id
    AND po.obligation_type = 'salary_net'
    AND po.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_OBLIGATION_MISSING: salary_net obligation not found';
  END IF;

  v_amount := ROUND(v_transfer.amount, 2);
  v_payment_date := COALESCE(p_paid_at, NOW())::DATE;
  v_key := public.payroll_validate_idempotency_key('paystack:' || v_transfer.id::TEXT);
  v_fingerprint := public.payroll_payment_request_fingerprint(
    v_transfer.business_id,
    v_transfer.payroll_run_id,
    v_payment_date,
    v_amount,
    v_connection.clearing_account_id,
    v_transfer.reference,
    v_transfer.batch_id,
    v_transfer.batch_item_id,
    v_scope
  );
  v_key_hash := public.payroll_idempotency_key_sha256(v_key);

  SELECT * INTO v_existing
  FROM public.payroll_payments pp
  WHERE pp.business_id = v_transfer.business_id
    AND pp.idempotency_key = v_key
    AND pp.deleted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'PAYSTACK_PAYMENT_ALREADY_REVERSED: existing settlement has been reversed';
    END IF;
    v_payment_id := v_existing.id;
    v_journal_id := v_existing.journal_entry_id;
  ELSE
    INSERT INTO public.payroll_payments (
      business_id,
      payroll_run_id,
      payment_date,
      amount,
      payment_account_id,
      reference,
      notes,
      batch_id,
      batch_item_id,
      created_by,
      idempotency_key,
      idempotency_scope,
      request_fingerprint,
      idempotency_key_sha256
    ) VALUES (
      v_transfer.business_id,
      v_transfer.payroll_run_id,
      v_payment_date,
      v_amount,
      v_connection.clearing_account_id,
      public.payroll_normalize_payment_reference(v_transfer.reference),
      'Paystack salary transfer',
      v_transfer.batch_id,
      v_transfer.batch_item_id,
      v_transfer.initiated_by,
      v_key,
      v_scope,
      v_fingerprint,
      v_key_hash
    )
    RETURNING id INTO v_payment_id;

    v_journal_id := public._post_payroll_payment_journal_internal(
      v_transfer.business_id,
      v_payment_id,
      v_transfer.payroll_run_id,
      v_payment_date,
      v_amount,
      v_connection.clearing_account_id,
      v_run.payroll_month
    );

    INSERT INTO public.payroll_obligation_payments (
      business_id,
      payroll_run_id,
      payroll_obligation_id,
      payment_date,
      amount,
      payment_account_id,
      reference,
      notes,
      journal_entry_id,
      created_by,
      payroll_payment_id
    ) VALUES (
      v_transfer.business_id,
      v_transfer.payroll_run_id,
      v_obligation.id,
      v_payment_date,
      v_amount,
      v_connection.clearing_account_id,
      public.payroll_normalize_payment_reference(v_transfer.reference),
      'Paystack salary transfer',
      v_journal_id,
      v_transfer.initiated_by,
      v_payment_id
    )
    RETURNING id INTO v_obligation_payment_id;
  END IF;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);

  SELECT pp.payment_date, pp.reference, pp.payment_account_id
  INTO v_latest_payment
  FROM public.payroll_payments pp
  WHERE pp.business_id = v_transfer.business_id
    AND pp.payroll_run_id = v_transfer.payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
    AND pp.reversed_at IS NULL
  ORDER BY pp.payment_date DESC, pp.created_at DESC
  LIMIT 1;

  PERFORM public.finza_set_payroll_mutation_context('payment_settle');
  UPDATE public.payroll_obligations
  SET amount_paid = LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2)),
      status = public.payroll_obligation_status(
        COALESCE(amount_due, 0),
        LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2))
      ),
      latest_payment_date = v_latest_payment.payment_date,
      latest_payment_reference = v_latest_payment.reference,
      payment_account_id = v_latest_payment.payment_account_id,
      updated_at = NOW()
  WHERE id = v_obligation.id;

  PERFORM public.finza_set_payroll_mutation_context('batch_item_payment');
  UPDATE public.payroll_payment_batch_items
  SET status = 'paid',
      payroll_payment_id = v_payment_id,
      paid_at = COALESCE(p_paid_at, NOW()),
      paid_by = v_transfer.initiated_by,
      payment_reference = public.payroll_normalize_payment_reference(v_transfer.reference),
      provider_reference = NULLIF(BTRIM(COALESCE(p_provider_transfer_id, p_provider_transfer_code, '')), ''),
      failure_reason = NULL,
      updated_at = NOW()
  WHERE id = v_item.id;

  v_batch_status := public.payroll_derive_batch_status_from_items(v_batch.id);

  UPDATE public.payroll_payment_batches
  SET status = v_batch_status,
      updated_at = NOW()
  WHERE id = v_batch.id;

  v_fee_amount := CASE
    WHEN p_fee_pesewas IS NULL THEN NULL
    ELSE ROUND(p_fee_pesewas::NUMERIC / 100, 2)
  END;

  IF v_fee_amount IS NOT NULL AND v_fee_amount > 0 THEN
    IF v_connection.fee_account_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = v_connection.fee_account_id
        AND a.business_id = v_transfer.business_id
        AND a.type = 'expense'
        AND a.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'PAYSTACK_FEE_ACCOUNT_MISSING: payment processing fee expense account is missing';
    END IF;

    INSERT INTO public.journal_entries (
      business_id, date, description, reference_type, reference_id, posting_source
    ) VALUES (
      v_transfer.business_id,
      v_payment_date,
      'Paystack salary transfer fee - ' || LEFT(v_transfer.reference, 40),
      'paystack_transfer_fee',
      v_transfer.id,
      'system'
    )
    RETURNING id INTO v_fee_journal_id;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit, credit, description
    ) VALUES
      (v_fee_journal_id, v_connection.fee_account_id, v_fee_amount, 0, 'Paystack salary transfer fee'),
      (v_fee_journal_id, v_connection.clearing_account_id, 0, v_fee_amount, 'Paystack salary transfer fee');

    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_debit, v_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_fee_journal_id;

    IF ABS(v_debit - v_credit) > 0.01 OR ABS(v_debit - v_fee_amount) > 0.01 THEN
      RAISE EXCEPTION 'PAYSTACK_FEE_JOURNAL_IMBALANCE: fee journal is not balanced';
    END IF;
  END IF;

  UPDATE public.payroll_paystack_transfers
  SET status = 'successful',
      provider_status = p_provider_status,
      provider_transfer_id = NULLIF(BTRIM(COALESCE(p_provider_transfer_id, '')), ''),
      provider_transfer_code = NULLIF(BTRIM(COALESCE(p_provider_transfer_code, '')), ''),
      provider_reference = NULLIF(BTRIM(COALESCE(p_provider_transfer_id, p_provider_transfer_code, '')), ''),
      payment_id = v_payment_id,
      settlement_journal_id = v_journal_id,
      fee_amount = v_fee_amount,
      fee_journal_id = v_fee_journal_id,
      failure_reason = NULL,
      requires_attention_reason = NULL,
      confirmed_at = COALESCE(p_paid_at, NOW()),
      updated_at = NOW()
  WHERE id = v_transfer.id;

  PERFORM public.create_audit_log(
    v_transfer.business_id,
    v_transfer.initiated_by,
    'payroll.paystack_transfer_settled',
    'payroll_paystack_transfer',
    v_transfer.id,
    jsonb_build_object('status', v_transfer.status),
    jsonb_build_object(
      'status', 'successful',
      'payment_id', v_payment_id,
      'journal_entry_id', v_journal_id,
      'fee_amount', v_fee_amount,
      'fee_journal_id', v_fee_journal_id,
      'provider_transfer_id', p_provider_transfer_id
    ),
    NULL, NULL,
    format('Paystack salary transfer %s settled', LEFT(v_transfer.reference, 24))
  );

  PERFORM public.finza_clear_payroll_mutation_context();

  RETURN jsonb_build_object(
    'reused', v_existing.id IS NOT NULL,
    'transfer_id', v_transfer.id,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'fee_journal_id', v_fee_journal_id,
    'amount', v_amount,
    'amount_paid', LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)),
    'outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - ROUND(v_paid_total, 2), 2)),
    'batch_status', v_batch_status
  );
END;
$$;

COMMENT ON FUNCTION public.settle_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT
) IS
  'Service-role-only settlement of a verified Paystack salary transfer: Dr 2240 / Cr Paystack clearing, optional fee journal.';

REVOKE ALL ON FUNCTION public.settle_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, BIGINT
) TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 7) Reversal RPC (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payroll_paystack_transfer_atomic(
  p_transfer_id UUID,
  p_reason TEXT,
  p_provider_status TEXT,
  p_refund_fee BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_transfer public.payroll_paystack_transfers%ROWTYPE;
  v_connection public.business_paystack_payroll_accounts%ROWTYPE;
  v_payment public.payroll_payments%ROWTYPE;
  v_run public.payroll_runs%ROWTYPE;
  v_obligation public.payroll_obligations%ROWTYPE;
  v_obligation_payment public.payroll_obligation_payments%ROWTYPE;
  v_reversal_journal_id UUID;
  v_fee_reversal_journal_id UUID;
  v_paid_total NUMERIC := 0;
  v_batch_status TEXT;
  v_latest_payment RECORD;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_net_salaries_account_id UUID;
  v_fee_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  IF p_transfer_id IS NULL THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_INVALID_INPUT: transfer id is required';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_INVALID_INPUT: reversal reason must be 3-500 characters';
  END IF;

  SELECT * INTO v_transfer
  FROM public.payroll_paystack_transfers t
  WHERE t.id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_NOT_FOUND: transfer attempt not found';
  END IF;

  IF v_transfer.status = 'reversed' THEN
    RETURN jsonb_build_object(
      'reused', TRUE,
      'transfer_id', v_transfer.id,
      'payment_id', v_transfer.payment_id,
      'reversal_journal_id', v_transfer.reversal_journal_id
    );
  END IF;

  IF v_transfer.status <> 'successful' OR v_transfer.payment_id IS NULL THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_STATE_CONFLICT: only a successful settled transfer can be reversed';
  END IF;

  SELECT * INTO v_payment
  FROM public.payroll_payments pp
  WHERE pp.id = v_transfer.payment_id
    AND pp.business_id = v_transfer.business_id
    AND pp.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_PAYMENT_MISSING: settled payroll payment not found';
  END IF;

  IF v_payment.reversed_at IS NOT NULL OR v_payment.reversal_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_ALREADY_COMPLETED: payroll payment is already reversed';
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = v_payment.payroll_run_id
    AND pr.business_id = v_transfer.business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_run.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_PAYROLL_NOT_REVERSIBLE: payroll run is not approved or locked';
  END IF;

  SELECT * INTO v_connection
  FROM public.business_paystack_payroll_accounts c
  WHERE c.business_id = v_transfer.business_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_CONNECTION_MISSING: tenant Paystack connection not found';
  END IF;

  SELECT a.id INTO v_net_salaries_account_id
  FROM public.accounts a
  WHERE a.business_id = v_transfer.business_id
    AND a.code = '2240'
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_net_salaries_account_id IS NULL THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_LIABILITY_MISSING: Net Salaries Payable account (2240) not found';
  END IF;

  IF v_connection.clearing_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = v_connection.clearing_account_id
      AND a.business_id = v_transfer.business_id
      AND a.type = 'asset'
      AND a.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_CLEARING_MISSING: Paystack clearing asset account not found';
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_transfer.business_id, CURRENT_DATE);

  INSERT INTO public.journal_entries (
    business_id, date, description, reference_type, reference_id, posting_source, reverses_entry_id
  ) VALUES (
    v_transfer.business_id,
    CURRENT_DATE,
    'Reversed Paystack salary transfer - ' || LEFT(v_transfer.reference, 40),
    'payroll_payment_reversal',
    v_payment.id,
    'system',
    v_payment.journal_entry_id
  )
  RETURNING id INTO v_reversal_journal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  ) VALUES
    (v_reversal_journal_id, v_connection.clearing_account_id, ROUND(v_payment.amount, 2), 0, 'Reverse Paystack salary transfer (restore clearing)'),
    (v_reversal_journal_id, v_net_salaries_account_id, 0, ROUND(v_payment.amount, 2), 'Reverse Paystack salary transfer (restore 2240 payable)');

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_reversal_journal_id;

  IF ABS(v_debit - v_credit) > 0.01 OR ABS(v_debit - ROUND(v_payment.amount, 2)) > 0.01 THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_JOURNAL_IMBALANCE: reversal journal is not balanced';
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('payment_reverse');
  UPDATE public.payroll_payments
  SET reversed_at = NOW(),
      reversed_by = v_transfer.initiated_by,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason,
      updated_at = NOW()
  WHERE id = v_payment.id;

  SELECT * INTO v_obligation_payment
  FROM public.payroll_obligation_payments pop
  WHERE pop.payroll_payment_id = v_payment.id
    AND pop.business_id = v_transfer.business_id
    AND pop.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_OBLIGATION_PAYMENT_MISSING: linked obligation settlement not found';
  END IF;

  UPDATE public.payroll_obligation_payments
  SET reversed_at = NOW(),
      reversed_by = v_transfer.initiated_by,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason
  WHERE id = v_obligation_payment.id;

  SELECT * INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.business_id = v_transfer.business_id
    AND po.payroll_run_id = v_payment.payroll_run_id
    AND po.obligation_type = 'salary_net'
    AND po.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYSTACK_REVERSAL_OBLIGATION_MISSING: salary_net obligation not found';
  END IF;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);

  SELECT pp.payment_date, pp.reference, pp.payment_account_id
  INTO v_latest_payment
  FROM public.payroll_payments pp
  WHERE pp.business_id = v_transfer.business_id
    AND pp.payroll_run_id = v_payment.payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
    AND pp.reversed_at IS NULL
  ORDER BY pp.payment_date DESC, pp.created_at DESC
  LIMIT 1;

  PERFORM public.finza_set_payroll_mutation_context('payment_settle');
  UPDATE public.payroll_obligations
  SET amount_paid = LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2)),
      status = public.payroll_obligation_status(
        COALESCE(amount_due, 0),
        LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2))
      ),
      latest_payment_date = v_latest_payment.payment_date,
      latest_payment_reference = v_latest_payment.reference,
      payment_account_id = v_latest_payment.payment_account_id,
      updated_at = NOW()
  WHERE id = v_obligation.id;

  IF v_payment.batch_item_id IS NOT NULL AND v_payment.batch_id IS NOT NULL THEN
    PERFORM public.finza_set_payroll_mutation_context('payment_reverse');
    UPDATE public.payroll_payment_batch_items
    SET status = 'pending',
        payroll_payment_id = NULL,
        paid_at = NULL,
        paid_by = NULL,
        payment_reference = NULL,
        updated_at = NOW()
    WHERE id = v_payment.batch_item_id
      AND business_id = v_transfer.business_id
      AND status = 'paid'
      AND payroll_payment_id = v_payment.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAYSTACK_REVERSAL_BATCH_ITEM_CONFLICT: linked batch item is not in the expected paid state';
    END IF;

    v_batch_status := public.payroll_derive_batch_status_from_items(v_payment.batch_id);

    UPDATE public.payroll_payment_batches
    SET status = v_batch_status,
        updated_at = NOW()
    WHERE id = v_payment.batch_id
      AND business_id = v_transfer.business_id;
  END IF;

  IF COALESCE(p_refund_fee, FALSE)
     AND v_transfer.fee_journal_id IS NOT NULL
     AND v_transfer.fee_amount IS NOT NULL
     AND v_transfer.fee_amount > 0
     AND v_transfer.fee_reversal_journal_id IS NULL
  THEN
    SELECT a.id INTO v_fee_account_id
    FROM public.accounts a
    WHERE a.id = v_connection.fee_account_id
      AND a.business_id = v_transfer.business_id
      AND a.type = 'expense'
      AND a.deleted_at IS NULL;

    IF v_fee_account_id IS NOT NULL THEN
      INSERT INTO public.journal_entries (
        business_id, date, description, reference_type, reference_id, posting_source, reverses_entry_id
      ) VALUES (
        v_transfer.business_id,
        CURRENT_DATE,
        'Reversed Paystack salary transfer fee - ' || LEFT(v_transfer.reference, 40),
        'paystack_transfer_fee_reversal',
        v_transfer.id,
        'system',
        v_transfer.fee_journal_id
      )
      RETURNING id INTO v_fee_reversal_journal_id;

      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit, credit, description
      ) VALUES
        (v_fee_reversal_journal_id, v_connection.clearing_account_id, v_transfer.fee_amount, 0, 'Reverse Paystack transfer fee (restore clearing)'),
        (v_fee_reversal_journal_id, v_fee_account_id, 0, v_transfer.fee_amount, 'Reverse Paystack transfer fee (restore expense)');
    END IF;
  END IF;

  UPDATE public.payroll_paystack_transfers
  SET status = 'reversed',
      provider_status = COALESCE(p_provider_status, 'reversed'),
      reversal_journal_id = v_reversal_journal_id,
      fee_reversal_journal_id = v_fee_reversal_journal_id,
      reversed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_transfer.id;

  PERFORM public.create_audit_log(
    v_transfer.business_id,
    v_transfer.initiated_by,
    'payroll.paystack_transfer_reversed',
    'payroll_paystack_transfer',
    v_transfer.id,
    jsonb_build_object('status', 'successful'),
    jsonb_build_object(
      'status', 'reversed',
      'payment_id', v_payment.id,
      'reversal_journal_id', v_reversal_journal_id,
      'fee_reversal_journal_id', v_fee_reversal_journal_id,
      'reason', v_reason
    ),
    NULL, NULL,
    format('Paystack salary transfer %s reversed', LEFT(v_transfer.reference, 24))
  );

  PERFORM public.finza_clear_payroll_mutation_context();

  RETURN jsonb_build_object(
    'reused', FALSE,
    'transfer_id', v_transfer.id,
    'payment_id', v_payment.id,
    'reversal_journal_id', v_reversal_journal_id,
    'fee_reversal_journal_id', v_fee_reversal_journal_id,
    'obligation_amount_paid', LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)),
    'obligation_outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - ROUND(v_paid_total, 2), 2)),
    'batch_status', v_batch_status
  );
END;
$$;

COMMENT ON FUNCTION public.reverse_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, BOOLEAN
) IS
  'Service-role-only reversal of a verified Paystack salary transfer: Dr clearing / Cr 2240, optional fee refund journal.';

REVOKE ALL ON FUNCTION public.reverse_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_paystack_transfer_atomic(
  UUID, TEXT, TEXT, BOOLEAN
) TO postgres, service_role;

NOTIFY pgrst, 'reload schema';
