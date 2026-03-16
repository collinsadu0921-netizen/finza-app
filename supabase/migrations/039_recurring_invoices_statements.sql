-- Migration: Recurring Invoices, Statements, and Reminders
-- Adds recurring invoices, statement tracking, and reminder settings

-- ============================================================================
-- RECURRING_INVOICES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  next_run_date DATE NOT NULL,
  auto_send BOOLEAN DEFAULT false,
  auto_whatsapp BOOLEAN DEFAULT false,
  invoice_template_data JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  last_run_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_business_id ON recurring_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_customer_id ON recurring_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_run_date ON recurring_invoices(next_run_date);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_status ON recurring_invoices(status);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_deleted_at ON recurring_invoices(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- INVOICE_REMINDERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('overdue', 'custom')),
  days_after_due INTEGER DEFAULT 3,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_business_id ON invoice_reminders(business_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice_id ON invoice_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_sent_at ON invoice_reminders(sent_at);

-- ============================================================================
-- BUSINESS_REMINDER_SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  overdue_reminders_enabled BOOLEAN DEFAULT false,
  reminder_frequency_days INTEGER[] DEFAULT ARRAY[3, 7, 14],
  reminder_message_template TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_reminder_settings_business_id ON business_reminder_settings(business_id);

-- ============================================================================
-- FUNCTION: Calculate next run date based on frequency
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_next_run_date(
  p_current_date DATE,
  p_frequency TEXT
)
RETURNS DATE AS $$
BEGIN
  CASE p_frequency
    WHEN 'weekly' THEN
      RETURN p_current_date + INTERVAL '7 days';
    WHEN 'biweekly' THEN
      RETURN p_current_date + INTERVAL '14 days';
    WHEN 'monthly' THEN
      RETURN p_current_date + INTERVAL '1 month';
    WHEN 'quarterly' THEN
      RETURN p_current_date + INTERVAL '3 months';
    WHEN 'yearly' THEN
      RETURN p_current_date + INTERVAL '1 year';
    ELSE
      RETURN p_current_date + INTERVAL '1 month';
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Generate invoices from recurring templates
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_recurring_invoices()
RETURNS INTEGER AS $$
DECLARE
  recurring_record RECORD;
  new_invoice_id UUID;
  invoice_number TEXT;
  generated_count INTEGER := 0;
BEGIN
  -- Get all active recurring invoices due today or earlier
  FOR recurring_record IN
    SELECT *
    FROM recurring_invoices
    WHERE status = 'active'
      AND next_run_date <= CURRENT_DATE
      AND deleted_at IS NULL
  LOOP
    -- Generate invoice number
    SELECT generate_invoice_number_with_settings(recurring_record.business_id)
    INTO invoice_number;
    
    -- Extract template data
    DECLARE
      template_data JSONB := recurring_record.invoice_template_data;
      line_items JSONB := template_data->'line_items';
      notes TEXT := template_data->>'notes';
      apply_taxes BOOLEAN := COALESCE((template_data->>'apply_taxes')::BOOLEAN, true);
      payment_terms TEXT := template_data->>'payment_terms';
      subtotal NUMERIC := 0;
      total NUMERIC := 0;
      nhil NUMERIC := 0;
      getfund NUMERIC := 0;
      covid NUMERIC := 0;
      vat NUMERIC := 0;
      total_tax NUMERIC := 0;
    BEGIN
      -- Calculate subtotal from line items
      IF line_items IS NOT NULL THEN
        SELECT COALESCE(SUM((item->>'qty')::NUMERIC * (item->>'unit_price')::NUMERIC), 0)
        INTO subtotal
        FROM jsonb_array_elements(line_items) AS item;
      END IF;
      
      -- Calculate taxes (simplified - would need full GhanaTaxEngine logic)
      IF apply_taxes AND subtotal > 0 THEN
        nhil := subtotal * 0.025;
        getfund := subtotal * 0.025;
        covid := subtotal * 0.01;
        vat := (subtotal + nhil + getfund + covid) * 0.15;
        total_tax := nhil + getfund + covid + vat;
      END IF;
      
      total := subtotal + total_tax;
      
      -- Create invoice
      INSERT INTO invoices (
        business_id,
        customer_id,
        invoice_number,
        issue_date,
        due_date,
        payment_terms,
        notes,
        apply_taxes,
        subtotal,
        nhil,
        getfund,
        covid,
        vat,
        total_tax,
        total,
        status,
        public_token
      )
      VALUES (
        recurring_record.business_id,
        recurring_record.customer_id,
        invoice_number,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '30 days', -- Default 30 days
        payment_terms,
        notes,
        apply_taxes,
        subtotal,
        nhil,
        getfund,
        covid,
        vat,
        total_tax,
        total,
        CASE WHEN recurring_record.auto_send THEN 'sent' ELSE 'draft' END,
        encode(gen_random_bytes(32), 'base64url')
      )
      RETURNING id INTO new_invoice_id;
      
      -- Create invoice items
      IF line_items IS NOT NULL THEN
        INSERT INTO invoice_items (invoice_id, description, qty, unit_price, discount_amount, line_subtotal)
        SELECT
          new_invoice_id,
          item->>'description',
          (item->>'qty')::NUMERIC,
          (item->>'unit_price')::NUMERIC,
          COALESCE((item->>'discount_amount')::NUMERIC, 0),
          (item->>'qty')::NUMERIC * (item->>'unit_price')::NUMERIC - COALESCE((item->>'discount_amount')::NUMERIC, 0)
        FROM jsonb_array_elements(line_items) AS item;
      END IF;
      
      -- Update recurring invoice
      UPDATE recurring_invoices
      SET
        last_run_date = CURRENT_DATE,
        next_run_date = calculate_next_run_date(CURRENT_DATE::DATE, recurring_record.frequency),
        updated_at = NOW()
      WHERE id = recurring_record.id;
      
      generated_count := generated_count + 1;
    END;
  END LOOP;
  
  RETURN generated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at for recurring_invoices
DROP TRIGGER IF EXISTS update_recurring_invoices_updated_at ON recurring_invoices;
CREATE TRIGGER update_recurring_invoices_updated_at
  BEFORE UPDATE ON recurring_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for business_reminder_settings
DROP TRIGGER IF EXISTS update_business_reminder_settings_updated_at ON business_reminder_settings;
CREATE TRIGGER update_business_reminder_settings_updated_at
  BEFORE UPDATE ON business_reminder_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on recurring_invoices
ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recurring invoices for their business"
  ON recurring_invoices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = recurring_invoices.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert recurring invoices for their business"
  ON recurring_invoices FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = recurring_invoices.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update recurring invoices for their business"
  ON recurring_invoices FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = recurring_invoices.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete recurring invoices for their business"
  ON recurring_invoices FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = recurring_invoices.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on invoice_reminders
ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reminders for their business"
  ON invoice_reminders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = invoice_reminders.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert reminders for their business"
  ON invoice_reminders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = invoice_reminders.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on business_reminder_settings
ALTER TABLE business_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reminder settings for their business"
  ON business_reminder_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_reminder_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert reminder settings for their business"
  ON business_reminder_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_reminder_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update reminder settings for their business"
  ON business_reminder_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_reminder_settings.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

