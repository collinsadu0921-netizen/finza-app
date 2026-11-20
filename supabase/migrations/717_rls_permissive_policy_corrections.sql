-- 717_rls_permissive_policy_corrections.sql
-- Forward-only continuation of 716.
--
-- Removes the unconditional allow_all_* policies from the 14 production tables
-- and corrects the additional over-broad policies on eight reviewed tables.
--
-- Rules:
--   * anon/PUBLIC: no private financial/customer/audit access.
--   * authenticated: tenant-scoped, role-aware access.
--   * active accounting-firm engagements keep read/write access where the
--     existing product supports it.
--   * audit logs are append-only through SECURITY DEFINER RPCs; clients cannot
--     update or delete them.
--   * public reference data (wht_rates, available lounge packages) remains
--     readable only where intentionally public and safe.
--
-- No data changes. No changes to 716.

-- ---------------------------------------------------------------------------
-- 1. Helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_rls_can_admin_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_rls_business_role(p_business_id) IN ('owner','admin');
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_bill_business_id(p_bill_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.business_id FROM public.bills b WHERE b.id = p_bill_id;
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_credit_note_business_id(p_credit_note_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cn.business_id FROM public.credit_notes cn WHERE cn.id = p_credit_note_id;
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_product_business_id(p_product_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.business_id FROM public.products p WHERE p.id = p_product_id;
$$;

DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'finza_rls_can_admin_business(uuid)',
    'finza_rls_bill_business_id(uuid)',
    'finza_rls_credit_note_business_id(uuid)',
    'finza_rls_product_business_id(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Remove every unconditional allow_all_* policy in the 14-table scope.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  t text;
  tables text[] := ARRAY[
    'accounts','assets','audit_logs','bank_transactions','bill_items','bill_payments','bills',
    'credit_note_items','credit_notes','depreciation_entries','expense_categories',
    'reconciliation_periods','recurring_invoices','vat_returns'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname LIKE 'allow_all_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Re-running this migration during a controlled staging deploy must replace
-- only the policies it owns; it must not touch pre-existing scoped policies.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname='public' AND (
      policyname LIKE 'accounts_engagement_%' OR
      policyname LIKE 'assets_accounting_%' OR
      policyname LIKE 'assets_engagement_%' OR
      policyname LIKE 'audit_logs_accounting_%' OR
      policyname LIKE 'bank_transactions_accounting_%' OR
      policyname LIKE 'bills_accounting_%' OR
      policyname LIKE 'bill_items_accounting_%' OR
      policyname LIKE 'bill_payments_accounting_%' OR
      policyname LIKE 'credit_notes_accounting_%' OR
      policyname LIKE 'credit_note_items_accounting_%' OR
      policyname LIKE 'depreciation_entries_accounting_%' OR
      policyname LIKE 'depreciation_entries_engagement_%' OR
      policyname LIKE 'expense_categories_%' OR
      policyname LIKE 'reconciliation_periods_accounting_%' OR
      policyname LIKE 'recurring_invoices_accounting_%' OR
      policyname LIKE 'vat_returns_accounting_%'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. accounts
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.accounts TO authenticated;
GRANT ALL ON TABLE public.accounts TO service_role;

CREATE POLICY accounts_engagement_select ON public.accounts
  FOR SELECT TO authenticated
  USING (public.finza_rls_has_engagement(business_id, 'read'));

CREATE POLICY accounts_engagement_insert ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_has_engagement(business_id, 'write') AND is_system = false);

CREATE POLICY accounts_engagement_update ON public.accounts
  FOR UPDATE TO authenticated
  USING (public.finza_rls_has_engagement(business_id, 'write') AND is_system = false)
  WITH CHECK (public.finza_rls_has_engagement(business_id, 'write') AND is_system = false);

CREATE POLICY accounts_engagement_delete ON public.accounts
  FOR DELETE TO authenticated
  USING (public.finza_rls_has_engagement(business_id, 'write') AND is_system = false);

-- ---------------------------------------------------------------------------
-- 4. assets
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assets TO authenticated;
GRANT ALL ON TABLE public.assets TO service_role;

CREATE POLICY assets_accounting_select ON public.assets
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));

CREATE POLICY assets_engagement_insert ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_has_engagement(business_id, 'write'));

CREATE POLICY assets_engagement_update ON public.assets
  FOR UPDATE TO authenticated
  USING (public.finza_rls_has_engagement(business_id, 'write'))
  WITH CHECK (public.finza_rls_has_engagement(business_id, 'write'));

CREATE POLICY assets_engagement_delete ON public.assets
  FOR DELETE TO authenticated
  USING (public.finza_rls_has_engagement(business_id, 'write'));

-- ---------------------------------------------------------------------------
-- 5. audit_logs: append-only through create_audit_log/trusted functions.
--    Remove every client policy; recreate only tenant/accounting read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs', r.policyname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

CREATE POLICY audit_logs_accounting_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 6. bank_transactions
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.bank_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bank_transactions TO authenticated;
GRANT ALL ON TABLE public.bank_transactions TO service_role;

CREATE POLICY bank_transactions_accounting_select ON public.bank_transactions
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));

CREATE POLICY bank_transactions_accounting_insert ON public.bank_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

CREATE POLICY bank_transactions_accounting_update ON public.bank_transactions
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

CREATE POLICY bank_transactions_accounting_delete ON public.bank_transactions
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 7. bills / bill_items / bill_payments
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.bills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bills TO authenticated;
GRANT ALL ON TABLE public.bills TO service_role;

CREATE POLICY bills_accounting_select ON public.bills
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY bills_accounting_insert ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY bills_accounting_update ON public.bills
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY bills_accounting_delete ON public.bills
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

REVOKE ALL ON TABLE public.bill_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bill_items TO authenticated;
GRANT ALL ON TABLE public.bill_items TO service_role;

CREATE POLICY bill_items_accounting_select ON public.bill_items
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(public.finza_rls_bill_business_id(bill_id)));
CREATE POLICY bill_items_accounting_insert ON public.bill_items
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(public.finza_rls_bill_business_id(bill_id)));
CREATE POLICY bill_items_accounting_update ON public.bill_items
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(public.finza_rls_bill_business_id(bill_id)))
  WITH CHECK (public.finza_rls_can_write_accounting_business(public.finza_rls_bill_business_id(bill_id)));
CREATE POLICY bill_items_accounting_delete ON public.bill_items
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(public.finza_rls_bill_business_id(bill_id)));

REVOKE ALL ON TABLE public.bill_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bill_payments TO authenticated;
GRANT ALL ON TABLE public.bill_payments TO service_role;

CREATE POLICY bill_payments_accounting_select ON public.bill_payments
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY bill_payments_accounting_insert ON public.bill_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY bill_payments_accounting_update ON public.bill_payments
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY bill_payments_accounting_delete ON public.bill_payments
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 8. credit_notes / credit_note_items
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.credit_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_notes TO authenticated;
GRANT ALL ON TABLE public.credit_notes TO service_role;

CREATE POLICY credit_notes_accounting_select ON public.credit_notes
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY credit_notes_accounting_insert ON public.credit_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY credit_notes_accounting_update ON public.credit_notes
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY credit_notes_accounting_delete ON public.credit_notes
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

REVOKE ALL ON TABLE public.credit_note_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.credit_note_items TO authenticated;
GRANT ALL ON TABLE public.credit_note_items TO service_role;

CREATE POLICY credit_note_items_accounting_select ON public.credit_note_items
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(public.finza_rls_credit_note_business_id(credit_note_id)));
CREATE POLICY credit_note_items_accounting_insert ON public.credit_note_items
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(public.finza_rls_credit_note_business_id(credit_note_id)));
CREATE POLICY credit_note_items_accounting_update ON public.credit_note_items
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(public.finza_rls_credit_note_business_id(credit_note_id)))
  WITH CHECK (public.finza_rls_can_write_accounting_business(public.finza_rls_credit_note_business_id(credit_note_id)));
CREATE POLICY credit_note_items_accounting_delete ON public.credit_note_items
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(public.finza_rls_credit_note_business_id(credit_note_id)));

-- ---------------------------------------------------------------------------
-- 9. depreciation_entries: preserve posted/adjusted/reversed protections.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.depreciation_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.depreciation_entries TO authenticated;
GRANT ALL ON TABLE public.depreciation_entries TO service_role;

CREATE POLICY depreciation_entries_accounting_select ON public.depreciation_entries
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));

CREATE POLICY depreciation_entries_engagement_insert ON public.depreciation_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_has_engagement(business_id, 'write'));

-- Production's depreciation_entries schema predates the `status` column.
-- Keep the stronger staging rule when available; otherwise protect any entry
-- already linked to a journal, which is the immutable-posted condition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='depreciation_entries' AND column_name='status'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY depreciation_entries_engagement_update ON public.depreciation_entries
        FOR UPDATE TO authenticated
        USING (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
          AND status NOT IN ('posted','adjusted','reversed','reversal')
        )
        WITH CHECK (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
          AND status NOT IN ('posted','adjusted','reversed','reversal')
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY depreciation_entries_engagement_delete ON public.depreciation_entries
        FOR DELETE TO authenticated
        USING (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
          AND status NOT IN ('posted','adjusted','reversed','reversal')
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY depreciation_entries_engagement_update ON public.depreciation_entries
        FOR UPDATE TO authenticated
        USING (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
        )
        WITH CHECK (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY depreciation_entries_engagement_delete ON public.depreciation_entries
        FOR DELETE TO authenticated
        USING (
          public.finza_rls_has_engagement(business_id, 'write')
          AND journal_entry_id IS NULL
        )
    $policy$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 10. expense_categories
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.expense_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_categories TO authenticated;
GRANT ALL ON TABLE public.expense_categories TO service_role;

CREATE POLICY expense_categories_select ON public.expense_categories
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(business_id));

CREATE POLICY expense_categories_insert ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_can_write_accounting(business_id)
  );
CREATE POLICY expense_categories_update ON public.expense_categories
  FOR UPDATE TO authenticated
  USING (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_can_write_accounting(business_id)
  )
  WITH CHECK (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_can_write_accounting(business_id)
  );
CREATE POLICY expense_categories_delete ON public.expense_categories
  FOR DELETE TO authenticated
  USING (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_can_write_accounting(business_id)
  );

-- ---------------------------------------------------------------------------
-- 11. reconciliation_periods
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.reconciliation_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reconciliation_periods TO authenticated;
GRANT ALL ON TABLE public.reconciliation_periods TO service_role;

CREATE POLICY reconciliation_periods_accounting_select ON public.reconciliation_periods
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY reconciliation_periods_accounting_insert ON public.reconciliation_periods
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY reconciliation_periods_accounting_update ON public.reconciliation_periods
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY reconciliation_periods_accounting_delete ON public.reconciliation_periods
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 12. recurring_invoices
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.recurring_invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recurring_invoices TO authenticated;
GRANT ALL ON TABLE public.recurring_invoices TO service_role;

CREATE POLICY recurring_invoices_accounting_select ON public.recurring_invoices
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY recurring_invoices_accounting_insert ON public.recurring_invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY recurring_invoices_accounting_update ON public.recurring_invoices
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY recurring_invoices_accounting_delete ON public.recurring_invoices
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 13. vat_returns
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.vat_returns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vat_returns TO authenticated;
GRANT ALL ON TABLE public.vat_returns TO service_role;

CREATE POLICY vat_returns_accounting_select ON public.vat_returns
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY vat_returns_accounting_insert ON public.vat_returns
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY vat_returns_accounting_update ON public.vat_returns
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY vat_returns_accounting_delete ON public.vat_returns
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 14. Additional reviewed tables.
--     Drop every policy on the tables we fully replace, so production's
--     differently named permissive policies cannot survive.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  t text;
  tables text[] := ARRAY[
    'firm_business_claim_tokens','lounge_packages','product_modifiers',
    'products_variants','receipt_settings','stock_history','stock_movements'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- firm_business_claim_tokens: bearer tokens. No client access.
DROP POLICY IF EXISTS allow_claim_token_insert ON public.firm_business_claim_tokens;
DROP POLICY IF EXISTS allow_claim_token_select_by_token ON public.firm_business_claim_tokens;
DROP POLICY IF EXISTS allow_claim_token_update ON public.firm_business_claim_tokens;
REVOKE ALL ON TABLE public.firm_business_claim_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.firm_business_claim_tokens TO service_role;

-- lounge_packages: public catalogue, read-only. Only available packages.
DROP POLICY IF EXISTS "Allow anon read lounge_packages" ON public.lounge_packages;
DROP POLICY IF EXISTS "Allow authenticated manage lounge_packages" ON public.lounge_packages;
REVOKE ALL ON TABLE public.lounge_packages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lounge_packages TO anon, authenticated;
GRANT ALL ON TABLE public.lounge_packages TO service_role;
CREATE POLICY lounge_packages_public_select ON public.lounge_packages
  FOR SELECT TO anon, authenticated
  USING (available = true);

-- product_modifiers: tenant-scoped through products; managers write.
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.product_modifiers;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.product_modifiers;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.product_modifiers;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.product_modifiers;
REVOKE ALL ON TABLE public.product_modifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_modifiers TO authenticated;
GRANT ALL ON TABLE public.product_modifiers TO service_role;
CREATE POLICY product_modifiers_tenant_select ON public.product_modifiers
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY product_modifiers_tenant_insert ON public.product_modifiers
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY product_modifiers_tenant_update ON public.product_modifiers
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)))
  WITH CHECK (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY product_modifiers_tenant_delete ON public.product_modifiers
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));

-- products_variants: replace tenant policies with read/member + manager writes.
DROP POLICY IF EXISTS products_variants_tenant_delete ON public.products_variants;
DROP POLICY IF EXISTS products_variants_tenant_insert ON public.products_variants;
DROP POLICY IF EXISTS products_variants_tenant_select ON public.products_variants;
DROP POLICY IF EXISTS products_variants_tenant_update ON public.products_variants;
REVOKE ALL ON TABLE public.products_variants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products_variants TO authenticated;
GRANT ALL ON TABLE public.products_variants TO service_role;
CREATE POLICY products_variants_tenant_select ON public.products_variants
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY products_variants_tenant_insert ON public.products_variants
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY products_variants_tenant_update ON public.products_variants
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)))
  WITH CHECK (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));
CREATE POLICY products_variants_tenant_delete ON public.products_variants
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_manage_business(public.finza_rls_product_business_id(product_id)));

-- receipt_settings: all members read, only owner/admin write.
DROP POLICY IF EXISTS receipt_settings_tenant_delete ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_tenant_insert ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_tenant_select ON public.receipt_settings;
DROP POLICY IF EXISTS receipt_settings_tenant_update ON public.receipt_settings;
REVOKE ALL ON TABLE public.receipt_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.receipt_settings TO authenticated;
GRANT ALL ON TABLE public.receipt_settings TO service_role;
CREATE POLICY receipt_settings_tenant_select ON public.receipt_settings
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY receipt_settings_admin_insert ON public.receipt_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_admin_business(business_id));
CREATE POLICY receipt_settings_admin_update ON public.receipt_settings
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_admin_business(business_id))
  WITH CHECK (public.finza_rls_can_admin_business(business_id));
CREATE POLICY receipt_settings_admin_delete ON public.receipt_settings
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_admin_business(business_id));

-- stock_history: tenant read only. Writes are trusted/server-side.
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.stock_history;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.stock_history;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.stock_history;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.stock_history;
REVOKE ALL ON TABLE public.stock_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.stock_history TO authenticated;
GRANT ALL ON TABLE public.stock_history TO service_role;
CREATE POLICY stock_history_tenant_select ON public.stock_history
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(business_id));

-- stock_movements: tenant read + insert; no client update/delete.
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.stock_movements;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.stock_movements;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.stock_movements;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.stock_movements;
DROP POLICY IF EXISTS tenant_delete ON public.stock_movements;
DROP POLICY IF EXISTS tenant_insert ON public.stock_movements;
DROP POLICY IF EXISTS tenant_select ON public.stock_movements;
DROP POLICY IF EXISTS tenant_update ON public.stock_movements;
REVOKE ALL ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.stock_movements TO authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;
CREATE POLICY stock_movements_tenant_select ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY stock_movements_tenant_insert ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_retail(business_id));

-- wht_rates: intentional public statutory reference data. Read-only.
REVOKE ALL ON TABLE public.wht_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wht_rates TO anon, authenticated;
GRANT ALL ON TABLE public.wht_rates TO service_role;
-- Existing wht_rates_select_all policy remains intentionally public.

COMMENT ON TABLE public.audit_logs IS
  'Append-only audit trail. Clients may read tenant-scoped rows; writes go through SECURITY DEFINER create_audit_log/trusted functions.';
COMMENT ON TABLE public.firm_business_claim_tokens IS
  'Sensitive claim tokens. No direct client access; service_role/RPC only.';
COMMENT ON TABLE public.lounge_packages IS
  'Public catalogue of available packages. Read-only for anon/authenticated; writes service_role only.';
COMMENT ON TABLE public.wht_rates IS
  'Public statutory WHT reference rates. Read-only for anon/authenticated; writes service_role only.';
