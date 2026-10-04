-- Shop #1: tenant-isolate retail tables that still had open policies or no RLS.
-- Membership is owner OR business_users via finza_user_can_access_business (migration 382).
-- products_variants has no business_id on staging (429 is not applied). Tenant is the
-- parent product's business_id. Store-level separation is NOT added here. Owner and
-- admin must read every store in the company. Manager/cashier store locks stay in
-- application code.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products_variants'
  ) THEN
    ALTER TABLE public.products_variants ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Enable read access for all users" ON public.products_variants;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.products_variants;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.products_variants;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.products_variants;
    DROP POLICY IF EXISTS "products_variants_tenant_select" ON public.products_variants;
    DROP POLICY IF EXISTS "products_variants_tenant_insert" ON public.products_variants;
    DROP POLICY IF EXISTS "products_variants_tenant_update" ON public.products_variants;
    DROP POLICY IF EXISTS "products_variants_tenant_delete" ON public.products_variants;

    CREATE POLICY "products_variants_tenant_select"
      ON public.products_variants FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = products_variants.product_id
            AND public.finza_user_can_access_business(p.business_id)
        )
      );

    CREATE POLICY "products_variants_tenant_insert"
      ON public.products_variants FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = products_variants.product_id
            AND public.finza_user_can_access_business(p.business_id)
        )
      );

    CREATE POLICY "products_variants_tenant_update"
      ON public.products_variants FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = products_variants.product_id
            AND public.finza_user_can_access_business(p.business_id)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = products_variants.product_id
            AND public.finza_user_can_access_business(p.business_id)
        )
      );

    CREATE POLICY "products_variants_tenant_delete"
      ON public.products_variants FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.id = products_variants.product_id
            AND public.finza_user_can_access_business(p.business_id)
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'receipt_settings'
  ) THEN
    ALTER TABLE public.receipt_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Enable read access for all users" ON public.receipt_settings;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.receipt_settings;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.receipt_settings;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.receipt_settings;
    DROP POLICY IF EXISTS "receipt_settings_tenant_select" ON public.receipt_settings;
    DROP POLICY IF EXISTS "receipt_settings_tenant_insert" ON public.receipt_settings;
    DROP POLICY IF EXISTS "receipt_settings_tenant_update" ON public.receipt_settings;
    DROP POLICY IF EXISTS "receipt_settings_tenant_delete" ON public.receipt_settings;

    CREATE POLICY "receipt_settings_tenant_select"
      ON public.receipt_settings FOR SELECT
      USING (public.finza_user_can_access_business(business_id));

    CREATE POLICY "receipt_settings_tenant_insert"
      ON public.receipt_settings FOR INSERT
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "receipt_settings_tenant_update"
      ON public.receipt_settings FOR UPDATE
      USING (public.finza_user_can_access_business(business_id))
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "receipt_settings_tenant_delete"
      ON public.receipt_settings FOR DELETE
      USING (public.finza_user_can_access_business(business_id));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cashier_sessions'
  ) THEN
    ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "cashier_sessions_tenant_select" ON public.cashier_sessions;
    DROP POLICY IF EXISTS "cashier_sessions_tenant_insert" ON public.cashier_sessions;
    DROP POLICY IF EXISTS "cashier_sessions_tenant_update" ON public.cashier_sessions;
    DROP POLICY IF EXISTS "cashier_sessions_tenant_delete" ON public.cashier_sessions;

    CREATE POLICY "cashier_sessions_tenant_select"
      ON public.cashier_sessions FOR SELECT
      USING (public.finza_user_can_access_business(business_id));

    CREATE POLICY "cashier_sessions_tenant_insert"
      ON public.cashier_sessions FOR INSERT
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "cashier_sessions_tenant_update"
      ON public.cashier_sessions FOR UPDATE
      USING (public.finza_user_can_access_business(business_id))
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "cashier_sessions_tenant_delete"
      ON public.cashier_sessions FOR DELETE
      USING (public.finza_user_can_access_business(business_id));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parked_sales'
  ) THEN
    ALTER TABLE public.parked_sales ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "parked_sales_tenant_select" ON public.parked_sales;
    DROP POLICY IF EXISTS "parked_sales_tenant_insert" ON public.parked_sales;
    DROP POLICY IF EXISTS "parked_sales_tenant_update" ON public.parked_sales;
    DROP POLICY IF EXISTS "parked_sales_tenant_delete" ON public.parked_sales;

    CREATE POLICY "parked_sales_tenant_select"
      ON public.parked_sales FOR SELECT
      USING (public.finza_user_can_access_business(business_id));

    CREATE POLICY "parked_sales_tenant_insert"
      ON public.parked_sales FOR INSERT
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "parked_sales_tenant_update"
      ON public.parked_sales FOR UPDATE
      USING (public.finza_user_can_access_business(business_id))
      WITH CHECK (public.finza_user_can_access_business(business_id));

    CREATE POLICY "parked_sales_tenant_delete"
      ON public.parked_sales FOR DELETE
      USING (public.finza_user_can_access_business(business_id));
  END IF;
END $$;
