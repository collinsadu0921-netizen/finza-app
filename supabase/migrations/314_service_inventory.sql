-- ============================================================================
-- Migration: Service Inventory (Model B) — additive, retail-safe
-- ============================================================================
-- Creates service-only tables: service_catalog, service_material_inventory,
-- service_material_movements, service_jobs, service_job_material_usage.
-- RLS via business_users. Does NOT touch retail tables or routes.
-- ============================================================================

-- Ensure businesses table exists (required for FK; may be missing if running migrations in isolation)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'businesses') THEN
    CREATE TABLE public.businesses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL,
      name TEXT NOT NULL,
      industry TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- ============================================================================
-- 1. service_catalog — billable services (no stock)
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_price NUMERIC NOT NULL DEFAULT 0,
  tax_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_business_id ON service_catalog(business_id);

ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can view service_catalog for their business"
  ON service_catalog FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_catalog.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can insert service_catalog for their business"
  ON service_catalog FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_catalog.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can update service_catalog for their business"
  ON service_catalog FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_catalog.business_id AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_catalog.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can delete service_catalog for their business"
  ON service_catalog FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_catalog.business_id AND bu.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 2. service_material_inventory — service materials stock
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_material_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,
  quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
  average_cost NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_material_inventory_business_id ON service_material_inventory(business_id);

ALTER TABLE service_material_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can view service_material_inventory for their business"
  ON service_material_inventory FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_inventory.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can insert service_material_inventory for their business"
  ON service_material_inventory FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_inventory.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can update service_material_inventory for their business"
  ON service_material_inventory FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_inventory.business_id AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_inventory.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can delete service_material_inventory for their business"
  ON service_material_inventory FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_inventory.business_id AND bu.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. service_material_movements — audit trail for stock
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_material_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES service_material_inventory(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'adjustment', 'job_usage', 'return')),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_material_movements_business_id ON service_material_movements(business_id);
CREATE INDEX IF NOT EXISTS idx_service_material_movements_material_id ON service_material_movements(material_id);

ALTER TABLE service_material_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service_material_movements for their business" ON service_material_movements;
CREATE POLICY "Users can view service_material_movements for their business"
  ON service_material_movements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_movements.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert service_material_movements for their business" ON service_material_movements;
CREATE POLICY "Users can insert service_material_movements for their business"
  ON service_material_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_material_movements.business_id AND bu.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. service_jobs — service engagements
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  start_date DATE,
  end_date DATE,
  invoice_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_jobs_business_id ON service_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_service_jobs_customer_id ON service_jobs(customer_id);

ALTER TABLE service_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can view service_jobs for their business"
  ON service_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_jobs.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can insert service_jobs for their business"
  ON service_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_jobs.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can update service_jobs for their business"
  ON service_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_jobs.business_id AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_jobs.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can delete service_jobs for their business"
  ON service_jobs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_jobs.business_id AND bu.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. service_job_material_usage — materials used per job
-- ============================================================================
CREATE TABLE IF NOT EXISTS service_job_material_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES service_material_inventory(id) ON DELETE CASCADE,
  quantity_used NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_job_material_usage_business_id ON service_job_material_usage(business_id);
CREATE INDEX IF NOT EXISTS idx_service_job_material_usage_job_id ON service_job_material_usage(job_id);

ALTER TABLE service_job_material_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can view service_job_material_usage for their business"
  ON service_job_material_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_job_material_usage.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can insert service_job_material_usage for their business"
  ON service_job_material_usage FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_job_material_usage.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can update service_job_material_usage for their business"
  ON service_job_material_usage FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_job_material_usage.business_id AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_job_material_usage.business_id AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can delete service_job_material_usage for their business"
  ON service_job_material_usage FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = service_job_material_usage.business_id AND bu.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Service Materials Inventory account (1450) for service businesses
-- Ledger posting uses 1450 + 5100 (Cost of Services). 5100 already in system accounts.
-- ============================================================================
INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT b.id, 'Service Materials Inventory', '1450', 'asset', 'Service materials stock', TRUE
FROM businesses b
WHERE b.industry = 'service'
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = b.id AND a.code = '1450' AND (a.deleted_at IS NULL OR a.deleted_at IS NOT NULL)
  );

