-- ============================================================================
-- Migration 484: Payment posting integrity (Phase 2F)
-- ============================================================================
-- Problem: Migration 073/075 allowed payments to commit without journal entries
-- when post_payment_to_ledger failed (EXCEPTION swallowed → RAISE WARNING only).
-- Migration 218 restored fail-fast; this migration re-asserts strict behavior and
-- adds an idempotent repair RPC for existing orphan payments.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Strict trigger: ledger posting failure must abort payment INSERT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM journal_entries
      WHERE reference_type = 'payment'
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_payment_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_post_payment() IS
'AFTER INSERT on payments: posts to ledger via post_payment_to_ledger. Any exception aborts the INSERT (no silent orphan payments). Idempotent when journal already exists.';

-- ----------------------------------------------------------------------------
-- 2. Idempotent repair for payments that lack a payment journal entry
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION repair_orphan_invoice_payment_journals(
  p_business_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 200,
  p_actor TEXT DEFAULT 'repair'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment_rec RECORD;
  journal_id UUID;
  repaired JSONB := '[]'::JSONB;
  skipped JSONB := '[]'::JSONB;
  repaired_count INTEGER := 0;
  skipped_count INTEGER := 0;
  err_msg TEXT;
  row_limit INTEGER;
BEGIN
  row_limit := GREATEST(1, LEAST(COALESCE(p_limit, 200), 5000));

  FOR payment_rec IN
    SELECT
      p.id,
      p.business_id,
      p.invoice_id,
      p.amount,
      p.date,
      p.method,
      i.status AS invoice_status
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND (p_business_id IS NULL OR p.business_id = p_business_id)
      AND NOT EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.business_id = p.business_id
          AND je.reference_type = 'payment'
          AND je.reference_id = p.id
      )
    ORDER BY p.created_at DESC
    LIMIT row_limit
  LOOP
    BEGIN
      SELECT post_payment_to_ledger(payment_rec.id) INTO journal_id;

      repaired := repaired || jsonb_build_array(
        jsonb_build_object(
          'payment_id', payment_rec.id,
          'business_id', payment_rec.business_id,
          'journal_entry_id', journal_id,
          'actor', p_actor
        )
      );
      repaired_count := repaired_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        err_msg := SQLERRM;
        skipped := skipped || jsonb_build_array(
          jsonb_build_object(
            'payment_id', payment_rec.id,
            'business_id', payment_rec.business_id,
            'invoice_id', payment_rec.invoice_id,
            'amount', payment_rec.amount,
            'date', payment_rec.date,
            'method', payment_rec.method,
            'invoice_status', payment_rec.invoice_status,
            'reason', err_msg
          )
        );
        skipped_count := skipped_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'repaired_count', repaired_count,
    'skipped_count', skipped_count,
    'repaired', repaired,
    'skipped', skipped,
    'business_id_filter', p_business_id,
    'limit', row_limit
  );
END;
$$;

COMMENT ON FUNCTION repair_orphan_invoice_payment_journals(UUID, INTEGER, TEXT) IS
'Phase 2F: Idempotently post missing payment journals via post_payment_to_ledger. Skips rows that already have a journal. Returns repaired and skipped arrays with reasons. Does not modify existing journals.';

GRANT EXECUTE ON FUNCTION repair_orphan_invoice_payment_journals(UUID, INTEGER, TEXT) TO service_role;
