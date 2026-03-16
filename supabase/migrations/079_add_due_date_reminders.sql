-- Migration: Add due date reminder automation
-- This adds support for sending reminders before invoices become due

-- ============================================================================
-- UPDATE INVOICE_REMINDERS TABLE
-- ============================================================================
-- Add 'due_date' to reminder_type CHECK constraint
ALTER TABLE invoice_reminders
  DROP CONSTRAINT IF EXISTS invoice_reminders_reminder_type_check;

ALTER TABLE invoice_reminders
  ADD CONSTRAINT invoice_reminders_reminder_type_check
  CHECK (reminder_type IN ('overdue', 'due_date', 'custom'));

-- Add days_before_due column for due date reminders
ALTER TABLE invoice_reminders
  ADD COLUMN IF NOT EXISTS days_before_due INTEGER;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_type_sent 
  ON invoice_reminders(reminder_type, sent_at) 
  WHERE sent_at IS NOT NULL;

-- ============================================================================
-- UPDATE INVOICE_SETTINGS TABLE
-- ============================================================================
-- Add due date reminder settings
ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS due_date_reminders_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS due_date_reminder_days INTEGER DEFAULT 3;

-- Add comment for documentation
COMMENT ON COLUMN invoice_settings.due_date_reminders_enabled IS 'Enable automatic reminders before invoice due date';
COMMENT ON COLUMN invoice_settings.due_date_reminder_days IS 'Number of days before due date to send reminder (default: 3)';













