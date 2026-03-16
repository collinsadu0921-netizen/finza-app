-- Migration: Add Email Reminder Automation Support
-- Adds email reminder automation with interval-based tracking

-- ============================================================================
-- UPDATE BUSINESS_REMINDER_SETTINGS TABLE
-- ============================================================================

-- Add email reminder interval (default 7 days)
ALTER TABLE business_reminder_settings
  ADD COLUMN IF NOT EXISTS reminder_interval_days INTEGER DEFAULT 7;

-- Add email reminder enabled flag
ALTER TABLE business_reminder_settings
  ADD COLUMN IF NOT EXISTS email_reminders_enabled BOOLEAN DEFAULT true;

-- Add email reminder template (separate from WhatsApp template)
ALTER TABLE business_reminder_settings
  ADD COLUMN IF NOT EXISTS email_reminder_template TEXT;

-- ============================================================================
-- UPDATE INVOICE_REMINDERS TABLE
-- ============================================================================

-- Add reminder_method to track if reminder was sent via email or WhatsApp
ALTER TABLE invoice_reminders
  ADD COLUMN IF NOT EXISTS reminder_method TEXT CHECK (reminder_method IN ('email', 'whatsapp', 'both'));

-- Add next_reminder_date to track when next reminder should be sent (for interval-based reminders)
ALTER TABLE invoice_reminders
  ADD COLUMN IF NOT EXISTS next_reminder_date DATE;

-- Add index for efficient querying of reminders by next_reminder_date
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_next_date ON invoice_reminders(next_reminder_date) WHERE next_reminder_date IS NOT NULL;

-- Add index for invoice_id and sent_at for efficient overdue invoice queries
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice_sent ON invoice_reminders(invoice_id, sent_at);

-- ============================================================================
-- FUNCTION: Calculate next reminder date based on interval
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_next_reminder_date(
  p_sent_date DATE,
  p_interval_days INTEGER
)
RETURNS DATE AS $$
BEGIN
  RETURN p_sent_date + (p_interval_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENT UPDATES
-- ============================================================================

COMMENT ON COLUMN business_reminder_settings.reminder_interval_days IS 'Number of days between reminder emails for overdue invoices. Default is 7 days.';
COMMENT ON COLUMN business_reminder_settings.email_reminders_enabled IS 'Whether automated email reminders are enabled for overdue invoices.';
COMMENT ON COLUMN business_reminder_settings.email_reminder_template IS 'Email template for overdue invoice reminders. Can include placeholders like {{customer_name}}, {{invoice_number}}, {{outstanding_amount}}, {{due_date}}';
COMMENT ON COLUMN invoice_reminders.reminder_method IS 'Method used to send reminder: email, whatsapp, or both';
COMMENT ON COLUMN invoice_reminders.next_reminder_date IS 'Date when next reminder should be sent for interval-based reminders. NULL if no more reminders needed.';













