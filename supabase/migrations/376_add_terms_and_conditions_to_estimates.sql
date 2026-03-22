-- Add quote_terms_and_conditions to invoice_settings
-- Businesses set T&Cs once in settings; they auto-appear on every quote.
-- Same pattern as bank_name / momo_number.

ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS quote_terms_and_conditions TEXT;
