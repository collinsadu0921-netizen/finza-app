-- ============================================================================
-- Migration: Service Inventory (Model B)
-- Additive. Retail-safe. Ledger-integrated. No refactors.
-- Tables: service_catalog, service_material_inventory, service_material_movements,
--         service_jobs, service_job_material_usage
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

-- ----------------------------------------------------------------------------
-- 1. service_catalog — billable services (no stock)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_price NUMERIC NOT NULL DEFAULT 0,
  tax_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_business_id ON service_catalog(business_id);

ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_catalog_select_own_business"
  ON service_catalog FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_catalog.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_catalog_insert_own_business"
  ON service_catalog FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_catalog.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_catalog_update_own_business"
  ON service_catalog FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_catalog.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_catalog_delete_own_business"
  ON service_catalog FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_catalog.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2. service_material_inventory — service materials stock
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_material_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL,
  quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
  average_cost NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_material_inventory_business_id ON service_material_inventory(business_id);

ALTER TABLE service_material_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_material_inventory_select_own_business"
  ON service_material_inventory FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_inventory.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_material_inventory_insert_own_business"
  ON service_material_inventory FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_inventory.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_material_inventory_update_own_business"
  ON service_material_inventory FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_inventory.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_material_inventory_delete_own_business"
  ON service_material_inventory FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_inventory.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 3. service_material_movements — audit trail for stock
-- ----------------------------------------------------------------------------
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

CREATE POLICY "service_material_movements_select_own_business"
  ON service_material_movements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_movements.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_material_movements_insert_own_business"
  ON service_material_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_material_movements.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 4. service_jobs — service engagements
-- ----------------------------------------------------------------------------
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

CREATE POLICY "service_jobs_select_own_business"
  ON service_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_jobs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_jobs_insert_own_business"
  ON service_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_jobs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_jobs_update_own_business"
  ON service_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_jobs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_jobs_delete_own_business"
  ON service_jobs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_jobs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5. service_job_material_usage — materials used per job
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_job_material_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES service_material_inventory(id) ON DELETE RESTRICT,
  quantity_used NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_job_material_usage_business_id ON service_job_material_usage(business_id);
CREATE INDEX IF NOT EXISTS idx_service_job_material_usage_job_id ON service_job_material_usage(job_id);

ALTER TABLE service_job_material_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_job_material_usage_select_own_business"
  ON service_job_material_usage FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_job_material_usage.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_job_material_usage_insert_own_business"
  ON service_job_material_usage FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_job_material_usage.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_job_material_usage_update_own_business"
  ON service_job_material_usage FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_job_material_usage.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "service_job_material_usage_delete_own_business"
  ON service_job_material_usage FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = service_job_material_usage.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- Optional: updated_at triggers for service_catalog, service_material_inventory, service_jobs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION service_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'service_catalog_updated_at') THEN
    CREATE TRIGGER service_catalog_updated_at
      BEFORE UPDATE ON service_catalog
      FOR EACH ROW EXECUTE FUNCTION service_inventory_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'service_material_inventory_updated_at') THEN
    CREATE TRIGGER service_material_inventory_updated_at
      BEFORE UPDATE ON service_material_inventory
      FOR EACH ROW EXECUTE FUNCTION service_inventory_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'service_jobs_updated_at') THEN
    CREATE TRIGGER service_jobs_updated_at
      BEFORE UPDATE ON service_jobs
      FOR EACH ROW EXECUTE FUNCTION service_inventory_updated_at();
  END IF;
END;
$$;

COMMENT ON TABLE service_catalog IS 'Billable services for service businesses (no stock)';
COMMENT ON TABLE service_material_inventory IS 'Service materials stock (separate from retail inventory)';
COMMENT ON TABLE service_material_movements IS 'Audit trail for service material stock movements';
COMMENT ON TABLE service_jobs IS 'Service engagements/jobs';
COMMENT ON TABLE service_job_material_usage IS 'Materials consumed per service job';

-- ----------------------------------------------------------------------------
-- Service ledger accounts (additive backfill; do not modify create_system_accounts)
-- 1450 Service Materials Inventory (asset), 5110 Cost of Services (expense)
-- Used by service job material usage posting only. Retail uses 1200/5000.
-- ----------------------------------------------------------------------------
INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT DISTINCT a.business_id, 'Service Materials Inventory', '1450', 'asset', 'Service materials stock', TRUE
  FROM accounts a
  WHERE a.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounts a2 WHERE a2.business_id = a.business_id AND a2.code = '1450' AND a2.deleted_at IS NULL)
ON CONFLICT (business_id, code) DO NOTHING;

INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT DISTINCT a.business_id, 'Cost of Services', '5110', 'expense', 'Cost of services (material usage)', TRUE
  FROM accounts a
  WHERE a.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounts a2 WHERE a2.business_id = a.business_id AND a2.code = '5110' AND a2.deleted_at IS NULL)
ON CONFLICT (business_id, code) DO NOTHING;
