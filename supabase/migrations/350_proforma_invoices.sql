-- Migration 350: Proforma Invoices
-- Replaces the Orders feature with a Proforma Invoice workflow.
-- Pipeline: Quote → Proforma Invoice → Job → Final Invoice

-- ── 1. proforma_invoices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proforma_invoices (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id               UUID REFERENCES customers(id) ON DELETE SET NULL,
  proforma_number           TEXT,                     -- NULL until sent (system-assigned)
  status                    TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','cancelled','converted')),
  issue_date                DATE NOT NULL,
  validity_date             DATE,                     -- expiry / validity date
  -- Totals
  subtotal                  NUMERIC NOT NULL DEFAULT 0,
  total_tax                 NUMERIC NOT NULL DEFAULT 0,
  total                     NUMERIC NOT NULL DEFAULT 0,
  -- Legacy Ghana tax columns (derived from tax_lines)
  nhil                      NUMERIC NOT NULL DEFAULT 0,
  getfund                   NUMERIC NOT NULL DEFAULT 0,
  covid                     NUMERIC NOT NULL DEFAULT 0,
  vat                       NUMERIC NOT NULL DEFAULT 0,
  -- Currency
  currency_code             TEXT DEFAULT 'GHS',
  currency_symbol           TEXT DEFAULT '₵',
  -- Metadata
  payment_terms             TEXT,
  notes                     TEXT,
  footer_message            TEXT,
  apply_taxes               BOOLEAN NOT NULL DEFAULT true,
  -- Public sharing token
  public_token              TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  -- Canonical tax engine fields
  tax_lines                 JSONB,
  tax_engine_code           TEXT,
  tax_jurisdiction          TEXT,
  tax_engine_effective_from DATE,
  -- Conversion tracking
  source_estimate_id        UUID REFERENCES estimates(id) ON DELETE SET NULL,
  converted_invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  -- Timestamps
  sent_at                   TIMESTAMPTZ,
  accepted_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  -- Unique proforma number per business
  UNIQUE NULLS NOT DISTINCT (business_id, proforma_number)
);

-- ── 2. proforma_invoice_items ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proforma_invoice_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_invoice_id   UUID NOT NULL REFERENCES proforma_invoices(id) ON DELETE CASCADE,
  product_service_id    UUID REFERENCES products_services(id) ON DELETE SET NULL,
  description           TEXT NOT NULL,
  qty                   NUMERIC NOT NULL DEFAULT 1,
  unit_price            NUMERIC NOT NULL DEFAULT 0,
  discount_amount       NUMERIC NOT NULL DEFAULT 0,
  line_subtotal         NUMERIC NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Proforma number generator (PRF-000001 format) ─────────────────────────
CREATE OR REPLACE FUNCTION generate_proforma_number(p_business_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  next_seq INT;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(proforma_number FROM 5) AS INT)),
    0
  ) + 1
  INTO next_seq
  FROM proforma_invoices
  WHERE business_id = p_business_id
    AND proforma_number IS NOT NULL;

  RETURN 'PRF-' || LPAD(next_seq::TEXT, 6, '0');
END;
$$;

-- ── 4. updated_at trigger on proforma_invoices ────────────────────────────────
CREATE OR REPLACE FUNCTION update_proforma_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proforma_invoices_updated_at
  BEFORE UPDATE ON proforma_invoices
  FOR EACH ROW EXECUTE FUNCTION update_proforma_updated_at();

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_business_id   ON proforma_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_customer_id   ON proforma_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_proforma_invoices_status        ON proforma_invoices(status);
CREATE INDEX IF NOT EXISTS idx_proforma_invoice_items_proforma ON proforma_invoice_items(proforma_invoice_id);

-- ── 6. Add proforma link to estimates (Quote → Proforma conversion tracking) ──
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS converted_to_proforma_id UUID REFERENCES proforma_invoices(id) ON DELETE SET NULL;

-- ── 7. Add optional proforma link to service_jobs ─────────────────────────────
ALTER TABLE service_jobs
  ADD COLUMN IF NOT EXISTS proforma_invoice_id UUID REFERENCES proforma_invoices(id) ON DELETE SET NULL;
