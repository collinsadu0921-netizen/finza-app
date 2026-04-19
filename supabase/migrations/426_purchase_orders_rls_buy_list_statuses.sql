-- Align RLS with retail buy-list statuses (423): planned | ordered | partially_received | received | paid | cancelled.
-- Migration 198 still referenced draft/sent, which blocked PO line inserts and PO updates after 423.

-- ---------------------------------------------------------------------------
-- purchase_orders: allow updates across the buy-list lifecycle
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update purchase orders for their business" ON purchase_orders;

CREATE POLICY "Users can update purchase orders for their business"
  ON purchase_orders FOR UPDATE
  USING (
    status IN (
      'planned',
      'ordered',
      'partially_received',
      'received',
      'paid',
      'cancelled'
    )
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    status IN (
      'planned',
      'ordered',
      'partially_received',
      'received',
      'paid',
      'cancelled'
    )
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- purchase_order_items: insert on planned; mutate while editable / in-flight
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create purchase order items for their business" ON purchase_order_items;

CREATE POLICY "Users can create purchase order items for their business"
  ON purchase_order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'planned'
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can update purchase order items for their business" ON purchase_order_items;

CREATE POLICY "Users can update purchase order items for their business"
  ON purchase_order_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status IN ('planned', 'ordered', 'partially_received')
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status IN ('planned', 'ordered', 'partially_received')
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete purchase order items for their business" ON purchase_order_items;

CREATE POLICY "Users can delete purchase order items for their business"
  ON purchase_order_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'planned'
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );
