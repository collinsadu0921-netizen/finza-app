-- Track email delivery separately from WhatsApp delivery for payslips
-- Also adds whatsapp_sent_at for granular per-channel timestamps

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS sent_via_email BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_sent_at    TIMESTAMP WITH TIME ZONE;

-- Existing sent_at column remains as "first sent via any channel" timestamp
-- New columns give per-channel visibility for the payroll dashboard

COMMENT ON COLUMN payslips.sent_via_whatsapp IS 'TRUE when payslip has been sent to staff via WhatsApp';
COMMENT ON COLUMN payslips.sent_via_email    IS 'TRUE when payslip has been sent to staff via email';
COMMENT ON COLUMN payslips.sent_at           IS 'Timestamp of first delivery (any channel)';
COMMENT ON COLUMN payslips.whatsapp_sent_at  IS 'Timestamp of most recent WhatsApp delivery';
COMMENT ON COLUMN payslips.email_sent_at     IS 'Timestamp of most recent email delivery';
