-- Migration: Create automations framework for Service mode
-- Automations are lightweight, read-only notifications/emails that do NOT modify financial data

-- ============================================================================
-- CREATE AUTOMATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Automation identity
  name TEXT NOT NULL,
  description TEXT,
  
  -- Automation type and trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event', 'schedule')),
  event_type TEXT CHECK (event_type IN ('invoice_overdue', 'invoice_due_soon', 'payment_received', 'vat_filing_deadline')),
  schedule_type TEXT CHECK (schedule_type IN ('daily', 'monthly')),
  
  -- Configuration (JSON for flexibility)
  config JSONB DEFAULT '{}'::jsonb,
  
  -- State
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_trigger_config CHECK (
    (trigger_type = 'event' AND event_type IS NOT NULL) OR
    (trigger_type = 'schedule' AND schedule_type IS NOT NULL)
  )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_automations_business_id ON automations(business_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automations_event_type ON automations(event_type);

-- Enable RLS
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now, can be restricted later)
DROP POLICY IF EXISTS "allow_all_select_automations" ON automations;
CREATE POLICY "allow_all_select_automations" ON automations FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_all_insert_automations" ON automations;
CREATE POLICY "allow_all_insert_automations" ON automations FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_update_automations" ON automations;
CREATE POLICY "allow_all_update_automations" ON automations FOR UPDATE USING (true);

DROP POLICY IF EXISTS "allow_all_delete_automations" ON automations;
CREATE POLICY "allow_all_delete_automations" ON automations FOR DELETE USING (true);

-- ============================================================================
-- SEED DEFAULT AUTOMATIONS FOR SERVICE MODE
-- ============================================================================
-- This function seeds default automations for a business
CREATE OR REPLACE FUNCTION seed_default_automations(business_uuid UUID)
RETURNS void AS $$
BEGIN
  -- Only seed if business doesn't have any automations yet
  IF NOT EXISTS (
    SELECT 1 FROM automations WHERE business_id = business_uuid
  ) THEN
    -- Invoice Overdue Automation
    INSERT INTO automations (business_id, name, description, trigger_type, event_type, enabled, config)
    VALUES (
      business_uuid,
      'Invoice Overdue Notification',
      'Automatically send notifications when invoices become overdue',
      'event',
      'invoice_overdue',
      true,
      '{"notification_types": ["email"]}'::jsonb
    );

    -- Invoice Due Soon Automation
    INSERT INTO automations (business_id, name, description, trigger_type, event_type, enabled, config)
    VALUES (
      business_uuid,
      'Invoice Due Soon Reminder',
      'Send reminder notifications 3 days before invoice due date',
      'event',
      'invoice_due_soon',
      false,
      '{"days_before": 3, "notification_types": ["email"]}'::jsonb
    );

    -- Payment Received Automation
    INSERT INTO automations (business_id, name, description, trigger_type, event_type, enabled, config)
    VALUES (
      business_uuid,
      'Payment Received Confirmation',
      'Send confirmation email when payment is received',
      'event',
      'payment_received',
      true,
      '{"notification_types": ["email"]}'::jsonb
    );

    -- Daily Summary Automation
    INSERT INTO automations (business_id, name, description, trigger_type, schedule_type, enabled, config)
    VALUES (
      business_uuid,
      'Daily Summary Report',
      'Send daily summary of invoices and payments via email',
      'schedule',
      'daily',
      false,
      '{"notification_types": ["email"], "send_time": "09:00"}'::jsonb
    );

    -- Monthly Summary Automation
    INSERT INTO automations (business_id, name, description, trigger_type, schedule_type, enabled, config)
    VALUES (
      business_uuid,
      'Monthly Summary Report',
      'Send monthly financial summary via email',
      'schedule',
      'monthly',
      false,
      '{"notification_types": ["email"], "send_day": 1}'::jsonb
    );

    -- VAT Filing Deadline Reminder Automation
    INSERT INTO automations (business_id, name, description, trigger_type, event_type, enabled, config)
    VALUES (
      business_uuid,
      'VAT Filing Deadline Reminder',
      'Remind business owner when VAT filing deadline is approaching (7 days before deadline). Reminder only - no automatic submission.',
      'event',
      'vat_filing_deadline',
      true,
      '{"days_before_deadline": 7, "notification_types": ["email", "in_app"]}'::jsonb
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_automations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_automations_updated_at ON automations;
CREATE TRIGGER update_automations_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW
  EXECUTE FUNCTION update_automations_updated_at();

