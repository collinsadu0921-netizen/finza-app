DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON audit_logs;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON audit_logs;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON audit_logs;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON audit_logs;
    DROP POLICY IF EXISTS "allow_all_select" ON audit_logs;
    DROP POLICY IF EXISTS "allow_all_insert" ON audit_logs;
    DROP POLICY IF EXISTS "allow_all_update" ON audit_logs;
    DROP POLICY IF EXISTS "allow_all_delete" ON audit_logs;
    DROP POLICY IF EXISTS "Users can view audit logs for their business" ON audit_logs;
    DROP POLICY IF EXISTS "Users can insert audit logs for their business" ON audit_logs;

    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON audit_logs FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = audit_logs.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON audit_logs FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = audit_logs.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automations') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON automations;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON automations;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON automations;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON automations;
    DROP POLICY IF EXISTS "allow_all_select" ON automations;
    DROP POLICY IF EXISTS "allow_all_insert" ON automations;
    DROP POLICY IF EXISTS "allow_all_update" ON automations;
    DROP POLICY IF EXISTS "allow_all_delete" ON automations;
    DROP POLICY IF EXISTS "Users can view automations for their business" ON automations;
    DROP POLICY IF EXISTS "Users can insert automations for their business" ON automations;
    DROP POLICY IF EXISTS "Users can update automations for their business" ON automations;
    DROP POLICY IF EXISTS "Users can delete automations for their business" ON automations;

    ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON automations FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON automations FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON automations FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON automations FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_transactions') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON bank_transactions;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bank_transactions;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON bank_transactions;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bank_transactions;
    DROP POLICY IF EXISTS "allow_all_select" ON bank_transactions;
    DROP POLICY IF EXISTS "allow_all_insert" ON bank_transactions;
    DROP POLICY IF EXISTS "allow_all_update" ON bank_transactions;
    DROP POLICY IF EXISTS "allow_all_delete" ON bank_transactions;
    DROP POLICY IF EXISTS "Users can view bank transactions for their business" ON bank_transactions;
    DROP POLICY IF EXISTS "Users can insert bank transactions for their business" ON bank_transactions;
    DROP POLICY IF EXISTS "Users can update bank transactions for their business" ON bank_transactions;
    DROP POLICY IF EXISTS "Users can delete bank transactions for their business" ON bank_transactions;

    ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON bank_transactions FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON bank_transactions FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON bank_transactions FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON bank_transactions FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bills') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON bills;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bills;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON bills;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bills;
    DROP POLICY IF EXISTS "allow_all_select" ON bills;
    DROP POLICY IF EXISTS "allow_all_insert" ON bills;
    DROP POLICY IF EXISTS "allow_all_update" ON bills;
    DROP POLICY IF EXISTS "allow_all_delete" ON bills;
    DROP POLICY IF EXISTS "Users can view bills for their business" ON bills;
    DROP POLICY IF EXISTS "Users can insert bills for their business" ON bills;
    DROP POLICY IF EXISTS "Users can update bills for their business" ON bills;
    DROP POLICY IF EXISTS "Users can delete bills for their business" ON bills;

    ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON bills FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON bills FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON bills FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON bills FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bill_items') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON bill_items;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bill_items;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON bill_items;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bill_items;
    DROP POLICY IF EXISTS "allow_all_select" ON bill_items;
    DROP POLICY IF EXISTS "allow_all_insert" ON bill_items;
    DROP POLICY IF EXISTS "allow_all_update" ON bill_items;
    DROP POLICY IF EXISTS "allow_all_delete" ON bill_items;
    DROP POLICY IF EXISTS "Users can view bill items for their business" ON bill_items;
    DROP POLICY IF EXISTS "Users can insert bill items for their business" ON bill_items;
    DROP POLICY IF EXISTS "Users can update bill items for their business" ON bill_items;
    DROP POLICY IF EXISTS "Users can delete bill items for their business" ON bill_items;

    ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON bill_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON bill_items FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON bill_items FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON bill_items FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bill_payments') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON bill_payments;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bill_payments;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON bill_payments;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bill_payments;
    DROP POLICY IF EXISTS "allow_all_select" ON bill_payments;
    DROP POLICY IF EXISTS "allow_all_insert" ON bill_payments;
    DROP POLICY IF EXISTS "allow_all_update" ON bill_payments;
    DROP POLICY IF EXISTS "allow_all_delete" ON bill_payments;
    DROP POLICY IF EXISTS "Users can view bill payments for their business" ON bill_payments;
    DROP POLICY IF EXISTS "Users can insert bill payments for their business" ON bill_payments;
    DROP POLICY IF EXISTS "Users can update bill payments for their business" ON bill_payments;
    DROP POLICY IF EXISTS "Users can delete bill payments for their business" ON bill_payments;

    ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON bill_payments FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON bill_payments FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON bill_payments FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON bill_payments FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products_stock') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON products_stock;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON products_stock;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON products_stock;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON products_stock;
    DROP POLICY IF EXISTS "allow_all_select" ON products_stock;
    DROP POLICY IF EXISTS "allow_all_insert" ON products_stock;
    DROP POLICY IF EXISTS "allow_all_update" ON products_stock;
    DROP POLICY IF EXISTS "allow_all_delete" ON products_stock;
    DROP POLICY IF EXISTS "Users can view products stock for their business" ON products_stock;
    DROP POLICY IF EXISTS "Users can insert products stock for their business" ON products_stock;
    DROP POLICY IF EXISTS "Users can update products stock for their business" ON products_stock;
    DROP POLICY IF EXISTS "Users can delete products stock for their business" ON products_stock;

    ALTER TABLE products_stock ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON products_stock FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON products_stock FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON products_stock FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON products_stock FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_movements') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON stock_movements;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stock_movements;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON stock_movements;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stock_movements;
    DROP POLICY IF EXISTS "allow_all_select" ON stock_movements;
    DROP POLICY IF EXISTS "allow_all_insert" ON stock_movements;
    DROP POLICY IF EXISTS "allow_all_update" ON stock_movements;
    DROP POLICY IF EXISTS "allow_all_delete" ON stock_movements;
    DROP POLICY IF EXISTS "Users can view stock movements for their business" ON stock_movements;
    DROP POLICY IF EXISTS "Users can insert stock movements for their business" ON stock_movements;
    DROP POLICY IF EXISTS "Users can update stock movements for their business" ON stock_movements;
    DROP POLICY IF EXISTS "Users can delete stock movements for their business" ON stock_movements;

    ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON stock_movements FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON stock_movements FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON stock_movements FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON stock_movements FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stores') THEN
    DROP POLICY IF EXISTS "Enable read access for all users" ON stores;
    DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stores;
    DROP POLICY IF EXISTS "Enable update for authenticated users" ON stores;
    DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stores;
    DROP POLICY IF EXISTS "allow_all_select" ON stores;
    DROP POLICY IF EXISTS "allow_all_insert" ON stores;
    DROP POLICY IF EXISTS "allow_all_update" ON stores;
    DROP POLICY IF EXISTS "allow_all_delete" ON stores;
    DROP POLICY IF EXISTS "Users can view stores for their business" ON stores;
    DROP POLICY IF EXISTS "Users can insert stores for their business" ON stores;
    DROP POLICY IF EXISTS "Users can update stores for their business" ON stores;
    DROP POLICY IF EXISTS "Users can delete stores for their business" ON stores;

    ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "tenant_select" ON stores FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_insert" ON stores FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_update" ON stores FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );

    CREATE POLICY "tenant_delete" ON stores FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;
