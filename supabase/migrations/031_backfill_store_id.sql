-- Migration: Backfill null store_id in sales and registers
-- This migration assigns store_id to records that are missing it
-- based on the user's assigned store at the time of creation

-- Backfill sales.store_id based on user.store_id
-- Only update sales where store_id is NULL
UPDATE sales
SET store_id = (
  SELECT u.store_id
  FROM users u
  WHERE u.id = sales.user_id
  LIMIT 1
)
WHERE store_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = sales.user_id
      AND u.store_id IS NOT NULL
  );

-- Backfill sale_items.store_id from parent sale
UPDATE sale_items
SET store_id = (
  SELECT s.store_id
  FROM sales s
  WHERE s.id = sale_items.sale_id
  LIMIT 1
)
WHERE store_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM sales s
    WHERE s.id = sale_items.sale_id
      AND s.store_id IS NOT NULL
  );

-- Backfill registers.store_id based on user.store_id
-- Only update registers where store_id is NULL
UPDATE registers
SET store_id = (
  SELECT u.store_id
  FROM users u
  WHERE u.id = registers.created_by
    OR u.id IN (
      SELECT user_id
      FROM cashier_sessions
      WHERE register_id = registers.id
      LIMIT 1
    )
  LIMIT 1
)
WHERE store_id IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = registers.created_by
        AND u.store_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM cashier_sessions cs
      JOIN users u ON u.id = cs.user_id
      WHERE cs.register_id = registers.id
        AND u.store_id IS NOT NULL
      LIMIT 1
    )
  );

-- Backfill cashier_sessions.store_id from register
UPDATE cashier_sessions
SET store_id = (
  SELECT r.store_id
  FROM registers r
  WHERE r.id = cashier_sessions.register_id
  LIMIT 1
)
WHERE store_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM registers r
    WHERE r.id = cashier_sessions.register_id
      AND r.store_id IS NOT NULL
  );

-- Log summary
DO $$
DECLARE
  sales_updated INTEGER;
  sale_items_updated INTEGER;
  registers_updated INTEGER;
  sessions_updated INTEGER;
BEGIN
  SELECT COUNT(*) INTO sales_updated
  FROM sales
  WHERE store_id IS NOT NULL;
  
  SELECT COUNT(*) INTO sale_items_updated
  FROM sale_items
  WHERE store_id IS NOT NULL;
  
  SELECT COUNT(*) INTO registers_updated
  FROM registers
  WHERE store_id IS NOT NULL;
  
  SELECT COUNT(*) INTO sessions_updated
  FROM cashier_sessions
  WHERE store_id IS NOT NULL;
  
  RAISE NOTICE 'Backfill complete:';
  RAISE NOTICE '  Sales with store_id: %', sales_updated;
  RAISE NOTICE '  Sale items with store_id: %', sale_items_updated;
  RAISE NOTICE '  Registers with store_id: %', registers_updated;
  RAISE NOTICE '  Sessions with store_id: %', sessions_updated;
END $$;

