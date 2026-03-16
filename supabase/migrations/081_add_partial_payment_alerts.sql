-- Migration: Add Internal Alerts for Partial Payments
-- Creates alerts table and trigger to notify business owners of partial payments

-- ============================================================================
-- INTERNAL_ALERTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS internal_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('partial_payment', 'other')),
  entity_type TEXT NOT NULL, -- 'invoice', 'payment', etc.
  entity_id UUID NOT NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_internal_alerts_business_id ON internal_alerts(business_id);
CREATE INDEX IF NOT EXISTS idx_internal_alerts_is_read ON internal_alerts(is_read) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_internal_alerts_created_at ON internal_alerts(created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_internal_alerts_alert_type ON internal_alerts(alert_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_internal_alerts_invoice_id ON internal_alerts(invoice_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- FUNCTION: Create alert for partial payment
-- ============================================================================

CREATE OR REPLACE FUNCTION create_partial_payment_alert()
RETURNS TRIGGER AS $$
DECLARE
  invoice_record RECORD;
  invoice_total NUMERIC;
  total_paid NUMERIC := 0;
  total_credits NUMERIC := 0;
  outstanding_amount NUMERIC;
  payment_amount NUMERIC;
  existing_alert_id UUID;
BEGIN
  -- Only process if payment is not deleted
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get invoice details
  SELECT id, invoice_number, total, business_id, customer_id
  INTO invoice_record
  FROM invoices
  WHERE id = NEW.invoice_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  invoice_total := invoice_record.total;
  payment_amount := NEW.amount;

  -- Sum all payments (including the one just inserted)
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

  -- Calculate outstanding amount after this payment
  outstanding_amount := invoice_total - total_paid - total_credits;

  -- Only create alert if payment leaves outstanding balance > 0 (partial payment)
  IF outstanding_amount > 0 THEN
    -- Check if alert already exists for this payment event
    -- We want to alert only once per payment
    SELECT id INTO existing_alert_id
    FROM internal_alerts
    WHERE business_id = invoice_record.business_id
      AND alert_type = 'partial_payment'
      AND payment_id = NEW.id
      AND deleted_at IS NULL
    LIMIT 1;

    -- Only create alert if it doesn't already exist
    IF existing_alert_id IS NULL THEN
      INSERT INTO internal_alerts (
        business_id,
        alert_type,
        entity_type,
        entity_id,
        invoice_id,
        payment_id,
        title,
        message,
        metadata
      ) VALUES (
        invoice_record.business_id,
        'partial_payment',
        'payment',
        NEW.id,
        NEW.invoice_id,
        NEW.id,
        'Partial Payment Received',
        format(
          'Invoice %s received a partial payment of %s. Outstanding balance: %s',
          invoice_record.invoice_number,
          payment_amount,
          outstanding_amount
        ),
        jsonb_build_object(
          'invoice_number', invoice_record.invoice_number,
          'payment_amount', payment_amount,
          'outstanding_amount', outstanding_amount,
          'invoice_total', invoice_total,
          'total_paid', total_paid
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Create alert when partial payment is received
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_partial_payment_alert ON payments;
CREATE TRIGGER trigger_partial_payment_alert
  AFTER INSERT ON payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL AND NEW.invoice_id IS NOT NULL)
  EXECUTE FUNCTION create_partial_payment_alert();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE internal_alerts IS 'Internal alerts for business owners (partial payments, etc.)';
COMMENT ON COLUMN internal_alerts.alert_type IS 'Type of alert: partial_payment, other';
COMMENT ON COLUMN internal_alerts.entity_type IS 'Type of entity that triggered the alert: invoice, payment, etc.';
COMMENT ON COLUMN internal_alerts.entity_id IS 'ID of the entity that triggered the alert';
COMMENT ON COLUMN internal_alerts.is_read IS 'Whether the alert has been read by the business owner';
COMMENT ON COLUMN internal_alerts.metadata IS 'Additional data about the alert (JSON)';













