-- Migration 488: Service trial read-only — RLS write hardening (financial tables)
-- Extends migration 487 beyond expenses. SELECT/read unchanged; INSERT/UPDATE/DELETE
-- require finza_business_can_write_service_records + business membership.

-- ----------------------------------------------------------------------------
-- Combined membership + trial write helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_service_trial_rls_can_write(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.finza_business_can_write_service_records(p_business_id)
     AND public.finza_user_can_access_business(p_business_id);
$$;

COMMENT ON FUNCTION public.finza_service_trial_rls_can_write(uuid) IS
  'RLS helper: business member/owner AND service trial write allowed (not locked / grace expired).';

GRANT EXECUTE ON FUNCTION public.finza_service_trial_rls_can_write(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Expenses: align with helper (owner + member, trial write)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "business members can insert expenses" ON public.expenses;
CREATE POLICY "business members can insert expenses"
ON public.expenses FOR INSERT
WITH CHECK (public.finza_service_trial_rls_can_write(expenses.business_id));

DROP POLICY IF EXISTS "business members can update expenses" ON public.expenses;
CREATE POLICY "business members can update expenses"
ON public.expenses FOR UPDATE
USING (public.finza_service_trial_rls_can_write(expenses.business_id))
WITH CHECK (public.finza_service_trial_rls_can_write(expenses.business_id));

DROP POLICY IF EXISTS "business members can delete expenses" ON public.expenses;
CREATE POLICY "business members can delete expenses"
ON public.expenses FOR DELETE
USING (public.finza_service_trial_rls_can_write(expenses.business_id));

-- ----------------------------------------------------------------------------
-- Macro: replace write policies on tables with direct business_id
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'invoices', 'payments', 'bills', 'bill_payments',
    'credit_notes', 'estimates', 'recurring_invoices', 'assets',
    'vat_returns'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY "service trial write insert" ON public.%1$I
      FOR INSERT WITH CHECK (public.finza_service_trial_rls_can_write(%1$I.business_id))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "service trial write update" ON public.%1$I
      FOR UPDATE
      USING (public.finza_service_trial_rls_can_write(%1$I.business_id))
      WITH CHECK (public.finza_service_trial_rls_can_write(%1$I.business_id))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY "service trial write delete" ON public.%1$I
      FOR DELETE
      USING (public.finza_service_trial_rls_can_write(%1$I.business_id))
    $f$, t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Child line items (resolve business_id via parent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.invoice_items') IS NOT NULL THEN
    ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can insert invoice items for their business invoices" ON public.invoice_items;
    DROP POLICY IF EXISTS "Users can update invoice items for their business invoices" ON public.invoice_items;
    DROP POLICY IF EXISTS "Users can delete invoice items for their business invoices" ON public.invoice_items;
    DROP POLICY IF EXISTS "service trial write insert" ON public.invoice_items;
    DROP POLICY IF EXISTS "service trial write update" ON public.invoice_items;
    DROP POLICY IF EXISTS "service trial write delete" ON public.invoice_items;

    CREATE POLICY "service trial write insert" ON public.invoice_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND public.finza_service_trial_rls_can_write(i.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.invoice_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND public.finza_service_trial_rls_can_write(i.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND public.finza_service_trial_rls_can_write(i.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.invoice_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.id = invoice_items.invoice_id
          AND public.finza_service_trial_rls_can_write(i.business_id)
      )
    );
  END IF;

  IF to_regclass('public.estimate_items') IS NOT NULL THEN
    ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can insert estimate items for their business estimates" ON public.estimate_items;
    DROP POLICY IF EXISTS "Users can update estimate items for their business estimates" ON public.estimate_items;
    DROP POLICY IF EXISTS "Users can delete estimate items for their business estimates" ON public.estimate_items;
    DROP POLICY IF EXISTS "service trial write insert" ON public.estimate_items;
    DROP POLICY IF EXISTS "service trial write update" ON public.estimate_items;
    DROP POLICY IF EXISTS "service trial write delete" ON public.estimate_items;

    CREATE POLICY "service trial write insert" ON public.estimate_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = estimate_items.estimate_id
          AND public.finza_service_trial_rls_can_write(e.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.estimate_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = estimate_items.estimate_id
          AND public.finza_service_trial_rls_can_write(e.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = estimate_items.estimate_id
          AND public.finza_service_trial_rls_can_write(e.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.estimate_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = estimate_items.estimate_id
          AND public.finza_service_trial_rls_can_write(e.business_id)
      )
    );
  END IF;

  IF to_regclass('public.credit_note_items') IS NOT NULL THEN
    ALTER TABLE public.credit_note_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can insert credit note items for their business" ON public.credit_note_items;
    DROP POLICY IF EXISTS "Users can update credit note items for their business" ON public.credit_note_items;
    DROP POLICY IF EXISTS "Users can delete credit note items for their business" ON public.credit_note_items;
    DROP POLICY IF EXISTS "service trial write insert" ON public.credit_note_items;
    DROP POLICY IF EXISTS "service trial write update" ON public.credit_note_items;
    DROP POLICY IF EXISTS "service trial write delete" ON public.credit_note_items;

    CREATE POLICY "service trial write insert" ON public.credit_note_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.credit_notes cn
        WHERE cn.id = credit_note_items.credit_note_id
          AND public.finza_service_trial_rls_can_write(cn.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.credit_note_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.credit_notes cn
        WHERE cn.id = credit_note_items.credit_note_id
          AND public.finza_service_trial_rls_can_write(cn.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.credit_notes cn
        WHERE cn.id = credit_note_items.credit_note_id
          AND public.finza_service_trial_rls_can_write(cn.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.credit_note_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.credit_notes cn
        WHERE cn.id = credit_note_items.credit_note_id
          AND public.finza_service_trial_rls_can_write(cn.business_id)
      )
    );
  END IF;

  IF to_regclass('public.bill_items') IS NOT NULL THEN
    ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Users can insert bill items for their business" ON public.bill_items;
    DROP POLICY IF EXISTS "Users can update bill items for their business" ON public.bill_items;
    DROP POLICY IF EXISTS "Users can delete bill items for their business" ON public.bill_items;
    DROP POLICY IF EXISTS "service trial write insert" ON public.bill_items;
    DROP POLICY IF EXISTS "service trial write update" ON public.bill_items;
    DROP POLICY IF EXISTS "service trial write delete" ON public.bill_items;

    CREATE POLICY "service trial write insert" ON public.bill_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.bills b
        WHERE b.id = bill_items.bill_id
          AND public.finza_service_trial_rls_can_write(b.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.bill_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.bills b
        WHERE b.id = bill_items.bill_id
          AND public.finza_service_trial_rls_can_write(b.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.bills b
        WHERE b.id = bill_items.bill_id
          AND public.finza_service_trial_rls_can_write(b.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.bill_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.bills b
        WHERE b.id = bill_items.bill_id
          AND public.finza_service_trial_rls_can_write(b.business_id)
      )
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Proforma (no prior RLS)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.proforma_invoices') IS NOT NULL THEN
    ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "service trial read select" ON public.proforma_invoices;
    DROP POLICY IF EXISTS "service trial write insert" ON public.proforma_invoices;
    DROP POLICY IF EXISTS "service trial write update" ON public.proforma_invoices;
    DROP POLICY IF EXISTS "service trial write delete" ON public.proforma_invoices;

    CREATE POLICY "service trial read select" ON public.proforma_invoices FOR SELECT
    USING (public.finza_user_can_access_business(proforma_invoices.business_id));

    CREATE POLICY "service trial write insert" ON public.proforma_invoices FOR INSERT
    WITH CHECK (public.finza_service_trial_rls_can_write(proforma_invoices.business_id));

    CREATE POLICY "service trial write update" ON public.proforma_invoices FOR UPDATE
    USING (public.finza_service_trial_rls_can_write(proforma_invoices.business_id))
    WITH CHECK (public.finza_service_trial_rls_can_write(proforma_invoices.business_id));

    CREATE POLICY "service trial write delete" ON public.proforma_invoices FOR DELETE
    USING (public.finza_service_trial_rls_can_write(proforma_invoices.business_id));
  END IF;

  IF to_regclass('public.proforma_invoice_items') IS NOT NULL THEN
    ALTER TABLE public.proforma_invoice_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "service trial read select" ON public.proforma_invoice_items;
    DROP POLICY IF EXISTS "service trial write insert" ON public.proforma_invoice_items;
    DROP POLICY IF EXISTS "service trial write update" ON public.proforma_invoice_items;
    DROP POLICY IF EXISTS "service trial write delete" ON public.proforma_invoice_items;

    CREATE POLICY "service trial read select" ON public.proforma_invoice_items FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.proforma_invoices p
        WHERE p.id = proforma_invoice_items.proforma_invoice_id
          AND public.finza_user_can_access_business(p.business_id)
      )
    );

    CREATE POLICY "service trial write insert" ON public.proforma_invoice_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.proforma_invoices p
        WHERE p.id = proforma_invoice_items.proforma_invoice_id
          AND public.finza_service_trial_rls_can_write(p.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.proforma_invoice_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.proforma_invoices p
        WHERE p.id = proforma_invoice_items.proforma_invoice_id
          AND public.finza_service_trial_rls_can_write(p.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.proforma_invoices p
        WHERE p.id = proforma_invoice_items.proforma_invoice_id
          AND public.finza_service_trial_rls_can_write(p.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.proforma_invoice_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.proforma_invoices p
        WHERE p.id = proforma_invoice_items.proforma_invoice_id
          AND public.finza_service_trial_rls_can_write(p.business_id)
      )
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Chart of accounts + journal (INSERT only at RLS; UPDATE/DELETE revoked in 222)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert accounts for their business" ON public.accounts;
CREATE POLICY "Users can insert accounts for their business"
  ON public.accounts FOR INSERT
  WITH CHECK (
    public.finza_service_trial_rls_can_write(accounts.business_id)
    AND accounts.is_system = FALSE
  );

DROP POLICY IF EXISTS "Users can update non-system accounts for their business" ON public.accounts;
CREATE POLICY "Users can update non-system accounts for their business"
  ON public.accounts FOR UPDATE
  USING (
    public.finza_service_trial_rls_can_write(accounts.business_id)
    AND accounts.is_system = FALSE
  )
  WITH CHECK (
    public.finza_service_trial_rls_can_write(accounts.business_id)
    AND accounts.is_system = FALSE
  );

DROP POLICY IF EXISTS "Users can delete non-system accounts for their business" ON public.accounts;
CREATE POLICY "Users can delete non-system accounts for their business"
  ON public.accounts FOR DELETE
  USING (
    public.finza_service_trial_rls_can_write(accounts.business_id)
    AND accounts.is_system = FALSE
  );

DROP POLICY IF EXISTS "Users can insert journal entries for their business" ON public.journal_entries;
CREATE POLICY "Users can insert journal entries for their business"
  ON public.journal_entries FOR INSERT
  WITH CHECK (public.finza_service_trial_rls_can_write(journal_entries.business_id));

DROP POLICY IF EXISTS accounting_business_scope_journal_entries ON public.journal_entries;
CREATE POLICY accounting_business_scope_journal_entries_select
  ON public.journal_entries FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY accounting_business_scope_journal_entries_insert
  ON public.journal_entries FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    AND public.finza_service_trial_rls_can_write(journal_entries.business_id)
  );

DROP POLICY IF EXISTS "Users can insert journal entry lines for their business" ON public.journal_entry_lines;
CREATE POLICY "Users can insert journal entry lines for their business"
  ON public.journal_entry_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.finza_service_trial_rls_can_write(je.business_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Accounting periods: owner + member write policies + scoped insert
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can insert accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Owners can insert accounting periods for their business"
  ON public.accounting_periods FOR INSERT
  WITH CHECK (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS "Owners can update accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Owners can update accounting periods for their business"
  ON public.accounting_periods FOR UPDATE
  USING (public.finza_service_trial_rls_can_write(accounting_periods.business_id))
  WITH CHECK (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS "Owners can delete accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Owners can delete accounting periods for their business"
  ON public.accounting_periods FOR DELETE
  USING (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS "Users can insert accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Users can insert accounting periods for their business"
  ON public.accounting_periods FOR INSERT
  WITH CHECK (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS "Users can update accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Users can update accounting periods for their business"
  ON public.accounting_periods FOR UPDATE
  USING (public.finza_service_trial_rls_can_write(accounting_periods.business_id))
  WITH CHECK (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS "Users can delete accounting periods for their business" ON public.accounting_periods;
CREATE POLICY "Users can delete accounting periods for their business"
  ON public.accounting_periods FOR DELETE
  USING (public.finza_service_trial_rls_can_write(accounting_periods.business_id));

DROP POLICY IF EXISTS accounting_business_scope_accounting_periods ON public.accounting_periods;
CREATE POLICY accounting_business_scope_accounting_periods_select
  ON public.accounting_periods FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY accounting_business_scope_accounting_periods_insert
  ON public.accounting_periods FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    AND public.finza_service_trial_rls_can_write(accounting_periods.business_id)
  );

CREATE POLICY accounting_business_scope_accounting_periods_update
  ON public.accounting_periods FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    AND public.finza_service_trial_rls_can_write(accounting_periods.business_id)
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    AND public.finza_service_trial_rls_can_write(accounting_periods.business_id)
  );

CREATE POLICY accounting_business_scope_accounting_periods_delete
  ON public.accounting_periods FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    AND public.finza_service_trial_rls_can_write(accounting_periods.business_id)
  );

-- ----------------------------------------------------------------------------
-- WHT / CIT service filing tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.wht_remittances') IS NOT NULL THEN
    ALTER TABLE public.wht_remittances ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wht_remittances_business_access ON public.wht_remittances;
    DROP POLICY IF EXISTS "service trial read select" ON public.wht_remittances;
    DROP POLICY IF EXISTS "service trial write insert" ON public.wht_remittances;
    DROP POLICY IF EXISTS "service trial write update" ON public.wht_remittances;
    DROP POLICY IF EXISTS "service trial write delete" ON public.wht_remittances;

    CREATE POLICY "service trial read select" ON public.wht_remittances FOR SELECT
    USING (public.finza_user_can_access_business(wht_remittances.business_id));

    CREATE POLICY "service trial write insert" ON public.wht_remittances FOR INSERT
    WITH CHECK (public.finza_service_trial_rls_can_write(wht_remittances.business_id));

    CREATE POLICY "service trial write update" ON public.wht_remittances FOR UPDATE
    USING (public.finza_service_trial_rls_can_write(wht_remittances.business_id))
    WITH CHECK (public.finza_service_trial_rls_can_write(wht_remittances.business_id));

    CREATE POLICY "service trial write delete" ON public.wht_remittances FOR DELETE
    USING (public.finza_service_trial_rls_can_write(wht_remittances.business_id));
  END IF;

  IF to_regclass('public.wht_remittance_bills') IS NOT NULL THEN
    ALTER TABLE public.wht_remittance_bills ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS wht_remittance_bills_access ON public.wht_remittance_bills;
    DROP POLICY IF EXISTS "service trial read select" ON public.wht_remittance_bills;
    DROP POLICY IF EXISTS "service trial write insert" ON public.wht_remittance_bills;
    DROP POLICY IF EXISTS "service trial write update" ON public.wht_remittance_bills;
    DROP POLICY IF EXISTS "service trial write delete" ON public.wht_remittance_bills;

    CREATE POLICY "service trial read select" ON public.wht_remittance_bills FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.wht_remittances wr
        WHERE wr.id = wht_remittance_bills.remittance_id
          AND public.finza_user_can_access_business(wr.business_id)
      )
    );

    CREATE POLICY "service trial write insert" ON public.wht_remittance_bills FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.wht_remittances wr
        WHERE wr.id = wht_remittance_bills.remittance_id
          AND public.finza_service_trial_rls_can_write(wr.business_id)
      )
    );
    CREATE POLICY "service trial write update" ON public.wht_remittance_bills FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.wht_remittances wr
        WHERE wr.id = wht_remittance_bills.remittance_id
          AND public.finza_service_trial_rls_can_write(wr.business_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.wht_remittances wr
        WHERE wr.id = wht_remittance_bills.remittance_id
          AND public.finza_service_trial_rls_can_write(wr.business_id)
      )
    );
    CREATE POLICY "service trial write delete" ON public.wht_remittance_bills FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.wht_remittances wr
        WHERE wr.id = wht_remittance_bills.remittance_id
          AND public.finza_service_trial_rls_can_write(wr.business_id)
      )
    );
  END IF;

  IF to_regclass('public.cit_provisions') IS NOT NULL THEN
    ALTER TABLE public.cit_provisions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS cit_provisions_business_access ON public.cit_provisions;
    DROP POLICY IF EXISTS "service trial read select" ON public.cit_provisions;
    DROP POLICY IF EXISTS "service trial write insert" ON public.cit_provisions;
    DROP POLICY IF EXISTS "service trial write update" ON public.cit_provisions;
    DROP POLICY IF EXISTS "service trial write delete" ON public.cit_provisions;

    CREATE POLICY "service trial read select" ON public.cit_provisions FOR SELECT
    USING (public.finza_user_can_access_business(cit_provisions.business_id));

    CREATE POLICY "service trial write insert" ON public.cit_provisions FOR INSERT
    WITH CHECK (public.finza_service_trial_rls_can_write(cit_provisions.business_id));

    CREATE POLICY "service trial write update" ON public.cit_provisions FOR UPDATE
    USING (public.finza_service_trial_rls_can_write(cit_provisions.business_id))
    WITH CHECK (public.finza_service_trial_rls_can_write(cit_provisions.business_id));

    CREATE POLICY "service trial write delete" ON public.cit_provisions FOR DELETE
    USING (public.finza_service_trial_rls_can_write(cit_provisions.business_id));
  END IF;
END $$;
