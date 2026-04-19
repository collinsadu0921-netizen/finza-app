-- Repair: 423 originally updated status to `planned` before dropping the legacy CHECK,
-- which fails with 23514 because `planned` is not allowed until the old constraint is removed.
-- Safe to re-run: drops and re-adds the expanded status check after normalizing legacy values.

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

UPDATE purchase_orders SET status = 'planned' WHERE status = 'draft';
UPDATE purchase_orders SET status = 'ordered' WHERE status = 'sent';

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('planned', 'ordered', 'partially_received', 'received', 'paid', 'cancelled'));

ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'planned';
