-- ============================================================================
-- Migration 589: one live source journal
-- ============================================================================
-- Package B (LED-001, LED-002). Stops a second live journal for the same
-- business, reference type, and source id.
--
-- A live journal has reverses_entry_id null, and no other row points
-- reverses_entry_id at it. A reversed journal does not block a replacement.
-- Expense edit inserts the reversal first, then posts the replacement.
--
-- No unique index. Posted rows cannot be updated, so an index on
-- reverses_entry_id IS NULL would reject expense reposts.
-- No update or delete of existing journals. Historical duplicates stay.
-- LED-004 orphan prevention is not in this migration: reference_id is
-- polymorphic and a source-row trigger is not safe for every journal type.
-- post_journal_entry overloads are not dropped. The 14-argument wrapper
-- still supplies posting_source for short named calls such as year-end close.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_one_live_source_journal(
  p_business_id uuid,
  p_reference_type text,
  p_reference_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_business_id IS NULL OR p_reference_id IS NULL THEN
    RAISE EXCEPTION 'assert_one_live_source_journal requires business_id and reference_id'
      USING ERRCODE = '23502';
  END IF;

  IF p_reference_type NOT IN (
    'invoice', 'credit_note', 'bill', 'expense', 'payment', 'bill_payment', 'sale'
  ) THEN
    RAISE EXCEPTION 'assert_one_live_source_journal does not cover reference_type %', p_reference_type
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_business_id::text),
    hashtext(p_reference_type || ':' || p_reference_id::text)
  );

  SELECT array_agg(je.id ORDER BY je.created_at, je.id)
  INTO v_ids
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = p_reference_type
    AND je.reference_id = p_reference_id
    AND je.reverses_entry_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries r
      WHERE r.reverses_entry_id = je.id
    );

  IF v_ids IS NULL OR coalesce(array_length(v_ids, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  IF array_length(v_ids, 1) > 1 THEN
    RAISE EXCEPTION 'multiple live journals for % %', p_reference_type, p_reference_id
      USING ERRCODE = '23505';
  END IF;

  RETURN v_ids[1];
END;
$$;

COMMENT ON FUNCTION public.assert_one_live_source_journal(uuid, text, uuid) IS
  'Returns the one live journal for a covered source, null when none exists, and raises when more than one live journal exists. Holds a transaction advisory lock for that source.';

CREATE OR REPLACE FUNCTION public.enforce_one_live_source_journal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF NEW.reference_id IS NULL OR NEW.reverses_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_type IS NULL OR NEW.reference_type NOT IN (
    'invoice', 'credit_note', 'bill', 'expense', 'payment', 'bill_payment', 'sale'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.business_id IS NULL THEN
    RAISE EXCEPTION 'journal business_id is required'
      USING ERRCODE = '23502';
  END IF;

  -- Same predicate and lock as assert_one_live_source_journal.
  -- Posting functions return an existing live id before INSERT, so a retry
  -- does not reach this trigger. A raw second insert raises.
  v_existing := public.assert_one_live_source_journal(
    NEW.business_id,
    NEW.reference_type,
    NEW.reference_id
  );

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate live journal for % %', NEW.reference_type, NEW.reference_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_one_live_source_journal ON public.journal_entries;

CREATE TRIGGER trigger_enforce_one_live_source_journal
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_one_live_source_journal();

COMMENT ON FUNCTION public.enforce_one_live_source_journal() IS
  'Rejects a second live journal for invoice, credit_note, bill, expense, payment, bill_payment, and sale. Reversals and other reference types are ignored.';

-- Wrappers keep the existing financial bodies. Each wrapper returns the live
-- journal before calling the body, under the advisory lock the trigger uses.

ALTER FUNCTION public.post_credit_note_to_ledger(uuid)
  RENAME TO post_credit_note_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_credit_note_to_ledger(p_credit_note_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT cn.business_id INTO v_business_id
  FROM public.credit_notes cn
  WHERE cn.id = p_credit_note_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'credit_note', p_credit_note_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_credit_note_to_ledger_pkgb_body(p_credit_note_id);
END;
$$;

ALTER FUNCTION public.post_bill_to_ledger(uuid, text, text, text)
  RENAME TO post_bill_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_bill_to_ledger(
  p_bill_id uuid,
  p_entry_type text DEFAULT NULL,
  p_backfill_reason text DEFAULT NULL,
  p_backfill_actor text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT b.business_id INTO v_business_id
  FROM public.bills b
  WHERE b.id = p_bill_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'bill', p_bill_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_bill_to_ledger_pkgb_body(
    p_bill_id, p_entry_type, p_backfill_reason, p_backfill_actor
  );
END;
$$;

ALTER FUNCTION public.post_bill_payment_to_ledger(uuid)
  RENAME TO post_bill_payment_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_bill_payment_to_ledger(p_bill_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT bp.business_id INTO v_business_id
  FROM public.bill_payments bp
  WHERE bp.id = p_bill_payment_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'bill_payment', p_bill_payment_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_bill_payment_to_ledger_pkgb_body(p_bill_payment_id);
END;
$$;

ALTER FUNCTION public.post_invoice_payment_to_ledger(uuid)
  RENAME TO post_invoice_payment_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_invoice_payment_to_ledger(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT p.business_id INTO v_business_id
  FROM public.payments p
  WHERE p.id = p_payment_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'payment', p_payment_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_invoice_payment_to_ledger_pkgb_body(p_payment_id);
END;
$$;

ALTER FUNCTION public.post_invoice_to_ledger(uuid, text, text, text)
  RENAME TO post_invoice_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_invoice_to_ledger(
  p_invoice_id uuid,
  p_entry_type text DEFAULT NULL,
  p_backfill_reason text DEFAULT NULL,
  p_backfill_actor text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT i.business_id INTO v_business_id
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'invoice', p_invoice_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_invoice_to_ledger_pkgb_body(
    p_invoice_id, p_entry_type, p_backfill_reason, p_backfill_actor
  );
END;
$$;

ALTER FUNCTION public.post_expense_to_ledger(uuid, text, text, text)
  RENAME TO post_expense_to_ledger_pkgb_body;

CREATE OR REPLACE FUNCTION public.post_expense_to_ledger(
  p_expense_id uuid,
  p_entry_type text DEFAULT NULL,
  p_backfill_reason text DEFAULT NULL,
  p_backfill_actor text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT e.business_id INTO v_business_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'expense', p_expense_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_expense_to_ledger_pkgb_body(
    p_expense_id, p_entry_type, p_backfill_reason, p_backfill_actor
  );
END;
$$;

-- Retail calls post_sale_to_ledger(uuid, uuid), which forwards to the
-- four-argument function. That overload checks for an existing sale journal
-- but does not take this lock. Wrapping it makes a concurrent retry return
-- the first journal instead of inserting into the trigger.
ALTER FUNCTION public.post_sale_to_ledger(uuid, text, text, text)
  RENAME TO post_sale_to_ledger_pkgb_body4;

CREATE OR REPLACE FUNCTION public.post_sale_to_ledger(
  p_sale_id uuid,
  p_entry_type text DEFAULT NULL,
  p_backfill_reason text DEFAULT NULL,
  p_backfill_actor text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT s.business_id INTO v_business_id
  FROM public.sales s
  WHERE s.id = p_sale_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'sale', p_sale_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_sale_to_ledger_pkgb_body4(
    p_sale_id, p_entry_type, p_backfill_reason, p_backfill_actor
  );
END;
$$;

ALTER FUNCTION public.post_sale_to_ledger(uuid, text, text, text, uuid)
  RENAME TO post_sale_to_ledger_pkgb_body5;

CREATE OR REPLACE FUNCTION public.post_sale_to_ledger(
  p_sale_id uuid,
  p_entry_type text DEFAULT NULL,
  p_backfill_reason text DEFAULT NULL,
  p_backfill_actor text DEFAULT NULL,
  p_posted_by_accountant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT s.business_id INTO v_business_id
  FROM public.sales s
  WHERE s.id = p_sale_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'sale', p_sale_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_sale_to_ledger_pkgb_body5(
    p_sale_id, p_entry_type, p_backfill_reason, p_backfill_actor, p_posted_by_accountant_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_one_live_source_journal(uuid, text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_one_live_source_journal() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_credit_note_to_ledger(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_bill_to_ledger(uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_bill_payment_to_ledger(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_invoice_payment_to_ledger(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_invoice_to_ledger(uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_expense_to_ledger(uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger(uuid, text, text, text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger(uuid, text, text, text, uuid) TO PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.post_credit_note_to_ledger(uuid) IS
  'Returns the live credit-note journal when one exists. Otherwise posts through the existing financial body.';
COMMENT ON FUNCTION public.post_bill_to_ledger(uuid, text, text, text) IS
  'Returns the live bill journal when one exists. Otherwise posts through the existing financial body.';
COMMENT ON FUNCTION public.post_bill_payment_to_ledger(uuid) IS
  'Returns the live bill-payment journal when one exists. Otherwise posts through the existing financial body.';
COMMENT ON FUNCTION public.post_invoice_payment_to_ledger(uuid) IS
  'Returns the live payment journal when one exists. Otherwise posts through the existing financial body.';
COMMENT ON FUNCTION public.post_invoice_to_ledger(uuid, text, text, text) IS
  'Returns the live invoice journal when one exists. Otherwise posts through the existing financial body.';
COMMENT ON FUNCTION public.post_expense_to_ledger(uuid, text, text, text) IS
  'Returns the live expense journal when one exists. A reversed expense journal does not block the replacement post.';
COMMENT ON FUNCTION public.post_sale_to_ledger(uuid, text, text, text) IS
  'Returns the live sale journal when one exists. Otherwise posts through the existing four-argument body. Retail refunds stay reversal rows.';
COMMENT ON FUNCTION public.post_sale_to_ledger(uuid, text, text, text, uuid) IS
  'Returns the live sale journal when one exists. Otherwise posts through the existing five-argument body.';
