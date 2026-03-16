-- Migration: Credit Notes & Invoice Adjustments
-- Adds credit notes system for Ghana invoice adjustments

-- ============================================================================
-- CREDIT_NOTES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  credit_number TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  nhil NUMERIC DEFAULT 0,
  getfund NUMERIC DEFAULT 0,
  covid NUMERIC DEFAULT 0,
  vat NUMERIC DEFAULT 0,
  total_tax NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'applied')),
  notes TEXT,
  public_token TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_credit_notes_business_id ON credit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_id ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_status ON credit_notes(status);
CREATE INDEX IF NOT EXISTS idx_credit_notes_credit_number ON credit_notes(credit_number);
CREATE INDEX IF NOT EXISTS idx_credit_notes_public_token ON credit_notes(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_deleted_at ON credit_notes(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- CREDIT_NOTE_ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  line_subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_credit_note_items_credit_note_id ON credit_note_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_invoice_item_id ON credit_note_items(invoice_item_id);

-- ============================================================================
-- FUNCTION: Generate credit note number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_credit_note_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  last_number INTEGER := 0;
  prefix TEXT := 'CN-';
  new_number TEXT;
BEGIN
  -- Get the last credit note number for this business
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(credit_number FROM LENGTH(prefix) + 1) AS INTEGER)),
    0
  )
  INTO last_number
  FROM credit_notes
  WHERE business_id = business_uuid
    AND credit_number LIKE prefix || '%'
    AND deleted_at IS NULL;

  -- Generate new number
  new_number := prefix || LPAD((last_number + 1)::TEXT, 4, '0');

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate invoice balance including credit notes
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_invoice_balance(invoice_uuid UUID)
RETURNS NUMERIC AS $$
DECLARE
  invoice_total NUMERIC;
  payments_sum NUMERIC := 0;
  credit_notes_sum NUMERIC := 0;
  balance NUMERIC;
BEGIN
  -- Get invoice total
  SELECT total INTO invoice_total
  FROM invoices
  WHERE id = invoice_uuid
    AND deleted_at IS NULL;

  IF invoice_total IS NULL THEN
    RETURN 0;
  END IF;

  -- Sum all payments
  SELECT COALESCE(SUM(amount), 0) INTO payments_sum
  FROM payments
  WHERE invoice_id = invoice_uuid
    AND deleted_at IS NULL;

  -- Sum all applied credit notes
  SELECT COALESCE(SUM(total), 0) INTO credit_notes_sum
  FROM credit_notes
  WHERE invoice_id = invoice_uuid
    AND status = 'applied'
    AND deleted_at IS NULL;

  -- Calculate balance
  balance := invoice_total - payments_sum - credit_notes_sum;

  RETURN GREATEST(0, balance); -- Never return negative
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update invoice status considering payments AND credit notes
-- ============================================================================
CREATE OR REPLACE FUNCTION update_invoice_status_with_credits()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC;
  total_paid NUMERIC;
  total_credits NUMERIC;
  invoice_status TEXT;
  invoice_due_date DATE;
  new_balance NUMERIC;
BEGIN
  SELECT total, status, due_date INTO invoice_total, invoice_status, invoice_due_date
  FROM invoices
  WHERE id = NEW.invoice_id;
  
  -- Sum all payments
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = NEW.invoice_id
    AND deleted_at IS NULL;
  
  -- Sum all applied credit notes
  SELECT COALESCE(SUM(total), 0) INTO total_credits
  FROM credit_notes
  WHERE invoice_id = NEW.invoice_id
    AND status = 'applied'
    AND deleted_at IS NULL;
  
  new_balance := invoice_total - total_paid - total_credits;
  
  -- Determine status
  IF new_balance <= 0 THEN
    invoice_status := 'paid';
  ELSIF total_paid > 0 OR total_credits > 0 THEN
    invoice_status := 'partially_paid';
  ELSE
    invoice_status := 'sent';
  END IF;
  
  -- Check if overdue
  IF invoice_status != 'paid' AND invoice_due_date IS NOT NULL THEN
    IF CURRENT_DATE > invoice_due_date THEN
      invoice_status := 'overdue';
    END IF;
  END IF;
  
  UPDATE invoices
  SET 
    status = invoice_status,
    paid_at = CASE WHEN invoice_status = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
    updated_at = NOW()
  WHERE id = NEW.invoice_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update the existing payment trigger to use the new function
DROP TRIGGER IF EXISTS trigger_update_invoice_status ON payments;
CREATE TRIGGER trigger_update_invoice_status
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION update_invoice_status_with_credits();

-- ============================================================================
-- TRIGGER: Update invoice status when credit note is applied
-- ============================================================================
CREATE OR REPLACE FUNCTION update_invoice_status_on_credit_note()
RETURNS TRIGGER AS $$
DECLARE
  invoice_record RECORD;
  new_balance NUMERIC;
BEGIN
  -- Only trigger when status changes to 'applied'
  IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN
    -- Get invoice details
    SELECT * INTO invoice_record
    FROM invoices
    WHERE id = NEW.invoice_id
      AND deleted_at IS NULL;

    IF invoice_record IS NOT NULL THEN
      -- Calculate new balance
      new_balance := calculate_invoice_balance(NEW.invoice_id);

      -- Update invoice status based on balance
      IF new_balance <= 0 THEN
        UPDATE invoices
        SET status = 'paid',
            paid_at = COALESCE(paid_at, NOW())
        WHERE id = NEW.invoice_id;
      ELSIF new_balance < invoice_record.total THEN
        UPDATE invoices
        SET status = 'partially_paid'
        WHERE id = NEW.invoice_id
          AND status != 'paid';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_invoice_on_credit_note ON credit_notes;
CREATE TRIGGER trigger_update_invoice_on_credit_note
  AFTER UPDATE OF status ON credit_notes
  FOR EACH ROW
  WHEN (NEW.status = 'applied')
  EXECUTE FUNCTION update_invoice_status_on_credit_note();

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at for credit_notes
DROP TRIGGER IF EXISTS update_credit_notes_updated_at ON credit_notes;
CREATE TRIGGER update_credit_notes_updated_at
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for credit_note_items
DROP TRIGGER IF EXISTS update_credit_note_items_updated_at ON credit_note_items;
CREATE TRIGGER update_credit_note_items_updated_at
  BEFORE UPDATE ON credit_note_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on credit_notes
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credit notes for their business"
  ON credit_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = credit_notes.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert credit notes for their business"
  ON credit_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = credit_notes.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update credit notes for their business"
  ON credit_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = credit_notes.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete credit notes for their business"
  ON credit_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = credit_notes.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on credit_note_items
ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credit note items for their business"
  ON credit_note_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM credit_notes
      JOIN businesses ON businesses.id = credit_notes.business_id
      WHERE credit_notes.id = credit_note_items.credit_note_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert credit note items for their business"
  ON credit_note_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM credit_notes
      JOIN businesses ON businesses.id = credit_notes.business_id
      WHERE credit_notes.id = credit_note_items.credit_note_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update credit note items for their business"
  ON credit_note_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM credit_notes
      JOIN businesses ON businesses.id = credit_notes.business_id
      WHERE credit_notes.id = credit_note_items.credit_note_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete credit note items for their business"
  ON credit_note_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM credit_notes
      JOIN businesses ON businesses.id = credit_notes.business_id
      WHERE credit_notes.id = credit_note_items.credit_note_id
        AND businesses.owner_id = auth.uid()
    )
  );

