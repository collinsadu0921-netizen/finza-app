DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounting_periods') THEN
    ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view accounting periods for their business" ON accounting_periods;
    CREATE POLICY "Users can view accounting periods for their business"
      ON accounting_periods FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_periods.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert accounting periods for their business" ON accounting_periods;
    CREATE POLICY "Users can insert accounting periods for their business"
      ON accounting_periods FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_periods.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update accounting periods for their business" ON accounting_periods;
    CREATE POLICY "Users can update accounting periods for their business"
      ON accounting_periods FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_periods.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_periods.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete accounting periods for their business" ON accounting_periods;
    CREATE POLICY "Users can delete accounting periods for their business"
      ON accounting_periods FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_periods.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounting_balances') THEN
    ALTER TABLE accounting_balances ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view accounting balances for their business" ON accounting_balances;
    CREATE POLICY "Users can view accounting balances for their business"
      ON accounting_balances FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_balances.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert accounting balances for their business" ON accounting_balances;
    CREATE POLICY "Users can insert accounting balances for their business"
      ON accounting_balances FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_balances.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update accounting balances for their business" ON accounting_balances;
    CREATE POLICY "Users can update accounting balances for their business"
      ON accounting_balances FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_balances.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = accounting_balances.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_entries') THEN
    ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view ledger entries for their business" ON ledger_entries;
    CREATE POLICY "Users can view ledger entries for their business"
      ON ledger_entries FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = ledger_entries.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert ledger entries for their business" ON ledger_entries;
    CREATE POLICY "Users can insert ledger entries for their business"
      ON ledger_entries FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = ledger_entries.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sales') THEN
    ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view sales for their business" ON sales;
    CREATE POLICY "Users can view sales for their business"
      ON sales FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = sales.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert sales for their business" ON sales;
    CREATE POLICY "Users can insert sales for their business"
      ON sales FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = sales.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update sales for their business" ON sales;
    CREATE POLICY "Users can update sales for their business"
      ON sales FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = sales.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = sales.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete sales for their business" ON sales;
    CREATE POLICY "Users can delete sales for their business"
      ON sales FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = sales.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sale_items') THEN
    ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view sale items for their business" ON sale_items;
    CREATE POLICY "Users can view sale items for their business"
      ON sale_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM sales s
          JOIN business_users bu ON bu.business_id = s.business_id
          WHERE s.id = sale_items.sale_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert sale items for their business" ON sale_items;
    CREATE POLICY "Users can insert sale items for their business"
      ON sale_items FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM sales s
          JOIN business_users bu ON bu.business_id = s.business_id
          WHERE s.id = sale_items.sale_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update sale items for their business" ON sale_items;
    CREATE POLICY "Users can update sale items for their business"
      ON sale_items FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM sales s
          JOIN business_users bu ON bu.business_id = s.business_id
          WHERE s.id = sale_items.sale_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM sales s
          JOIN business_users bu ON bu.business_id = s.business_id
          WHERE s.id = sale_items.sale_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete sale items for their business" ON sale_items;
    CREATE POLICY "Users can delete sale items for their business"
      ON sale_items FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM sales s
          JOIN business_users bu ON bu.business_id = s.business_id
          WHERE s.id = sale_items.sale_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view payments for their business" ON payments;
    CREATE POLICY "Users can view payments for their business"
      ON payments FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert payments for their business" ON payments;
    CREATE POLICY "Users can insert payments for their business"
      ON payments FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update payments for their business" ON payments;
    CREATE POLICY "Users can update payments for their business"
      ON payments FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = payments.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete payments for their business" ON payments;
    CREATE POLICY "Users can delete payments for their business"
      ON payments FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = payments.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bills') THEN
    ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view bills for their business" ON bills;
    CREATE POLICY "Users can view bills for their business"
      ON bills FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert bills for their business" ON bills;
    CREATE POLICY "Users can insert bills for their business"
      ON bills FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bills.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update bills for their business" ON bills;
    CREATE POLICY "Users can update bills for their business"
      ON bills FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete bills for their business" ON bills;
    CREATE POLICY "Users can delete bills for their business"
      ON bills FOR DELETE
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
    ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view bill items for their business" ON bill_items;
    CREATE POLICY "Users can view bill items for their business"
      ON bill_items FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert bill items for their business" ON bill_items;
    CREATE POLICY "Users can insert bill items for their business"
      ON bill_items FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM bills b
          JOIN business_users bu ON bu.business_id = b.business_id
          WHERE b.id = bill_items.bill_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update bill items for their business" ON bill_items;
    CREATE POLICY "Users can update bill items for their business"
      ON bill_items FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete bill items for their business" ON bill_items;
    CREATE POLICY "Users can delete bill items for their business"
      ON bill_items FOR DELETE
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
    ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view bill payments for their business" ON bill_payments;
    CREATE POLICY "Users can view bill payments for their business"
      ON bill_payments FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert bill payments for their business" ON bill_payments;
    CREATE POLICY "Users can insert bill payments for their business"
      ON bill_payments FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bill_payments.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update bill payments for their business" ON bill_payments;
    CREATE POLICY "Users can update bill payments for their business"
      ON bill_payments FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete bill payments for their business" ON bill_payments;
    CREATE POLICY "Users can delete bill payments for their business"
      ON bill_payments FOR DELETE
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
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bank_transactions') THEN
    ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view bank transactions for their business" ON bank_transactions;
    CREATE POLICY "Users can view bank transactions for their business"
      ON bank_transactions FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert bank transactions for their business" ON bank_transactions;
    CREATE POLICY "Users can insert bank transactions for their business"
      ON bank_transactions FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = bank_transactions.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update bank transactions for their business" ON bank_transactions;
    CREATE POLICY "Users can update bank transactions for their business"
      ON bank_transactions FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete bank transactions for their business" ON bank_transactions;
    CREATE POLICY "Users can delete bank transactions for their business"
      ON bank_transactions FOR DELETE
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
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view products for their business" ON products;
    CREATE POLICY "Users can view products for their business"
      ON products FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = products.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert products for their business" ON products;
    CREATE POLICY "Users can insert products for their business"
      ON products FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = products.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update products for their business" ON products;
    CREATE POLICY "Users can update products for their business"
      ON products FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = products.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = products.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete products for their business" ON products;
    CREATE POLICY "Users can delete products for their business"
      ON products FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = products.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products_stock') THEN
    ALTER TABLE products_stock ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view products stock for their business" ON products_stock;
    CREATE POLICY "Users can view products stock for their business"
      ON products_stock FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert products stock for their business" ON products_stock;
    CREATE POLICY "Users can insert products stock for their business"
      ON products_stock FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM products p
          JOIN business_users bu ON bu.business_id = p.business_id
          WHERE p.id = products_stock.product_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update products stock for their business" ON products_stock;
    CREATE POLICY "Users can update products stock for their business"
      ON products_stock FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete products stock for their business" ON products_stock;
    CREATE POLICY "Users can delete products stock for their business"
      ON products_stock FOR DELETE
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
    ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view stock movements for their business" ON stock_movements;
    CREATE POLICY "Users can view stock movements for their business"
      ON stock_movements FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert stock movements for their business" ON stock_movements;
    CREATE POLICY "Users can insert stock movements for their business"
      ON stock_movements FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stock_movements.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update stock movements for their business" ON stock_movements;
    CREATE POLICY "Users can update stock movements for their business"
      ON stock_movements FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete stock movements for their business" ON stock_movements;
    CREATE POLICY "Users can delete stock movements for their business"
      ON stock_movements FOR DELETE
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
    ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view stores for their business" ON stores;
    CREATE POLICY "Users can view stores for their business"
      ON stores FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert stores for their business" ON stores;
    CREATE POLICY "Users can insert stores for their business"
      ON stores FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update stores for their business" ON stores;
    CREATE POLICY "Users can update stores for their business"
      ON stores FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete stores for their business" ON stores;
    CREATE POLICY "Users can delete stores for their business"
      ON stores FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = stores.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'registers') THEN
    ALTER TABLE registers ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view registers for their business" ON registers;
    CREATE POLICY "Users can view registers for their business"
      ON registers FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = registers.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert registers for their business" ON registers;
    CREATE POLICY "Users can insert registers for their business"
      ON registers FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = registers.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update registers for their business" ON registers;
    CREATE POLICY "Users can update registers for their business"
      ON registers FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = registers.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = registers.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete registers for their business" ON registers;
    CREATE POLICY "Users can delete registers for their business"
      ON registers FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = registers.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'business_reminder_settings') THEN
    ALTER TABLE business_reminder_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view business reminder settings for their business" ON business_reminder_settings;
    CREATE POLICY "Users can view business reminder settings for their business"
      ON business_reminder_settings FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = business_reminder_settings.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert business reminder settings for their business" ON business_reminder_settings;
    CREATE POLICY "Users can insert business reminder settings for their business"
      ON business_reminder_settings FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = business_reminder_settings.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update business reminder settings for their business" ON business_reminder_settings;
    CREATE POLICY "Users can update business reminder settings for their business"
      ON business_reminder_settings FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = business_reminder_settings.business_id
            AND bu.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = business_reminder_settings.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can delete business reminder settings for their business" ON business_reminder_settings;
    CREATE POLICY "Users can delete business reminder settings for their business"
      ON business_reminder_settings FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = business_reminder_settings.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automations') THEN
    ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view automations for their business" ON automations;
    CREATE POLICY "Users can view automations for their business"
      ON automations FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert automations for their business" ON automations;
    CREATE POLICY "Users can insert automations for their business"
      ON automations FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = automations.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can update automations for their business" ON automations;
    CREATE POLICY "Users can update automations for their business"
      ON automations FOR UPDATE
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

    DROP POLICY IF EXISTS "Users can delete automations for their business" ON automations;
    CREATE POLICY "Users can delete automations for their business"
      ON automations FOR DELETE
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
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view audit logs for their business" ON audit_logs;
    CREATE POLICY "Users can view audit logs for their business"
      ON audit_logs FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = audit_logs.business_id
            AND bu.user_id = auth.uid()
        )
      );

    DROP POLICY IF EXISTS "Users can insert audit logs for their business" ON audit_logs;
    CREATE POLICY "Users can insert audit logs for their business"
      ON audit_logs FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM business_users bu
          WHERE bu.business_id = audit_logs.business_id
            AND bu.user_id = auth.uid()
        )
      );
  END IF;
END $$;
