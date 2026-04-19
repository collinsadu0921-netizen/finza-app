-- Optional international bank fields for invoice client-facing payment details (PDF + public link).
ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS bank_swift TEXT,
  ADD COLUMN IF NOT EXISTS bank_iban TEXT;

COMMENT ON COLUMN invoice_settings.bank_branch IS 'Optional branch — shown on invoice PDF/public when set';
COMMENT ON COLUMN invoice_settings.bank_swift IS 'Optional SWIFT/BIC — shown on invoice PDF/public when set';
COMMENT ON COLUMN invoice_settings.bank_iban IS 'Optional IBAN — shown on invoice PDF/public when set';
