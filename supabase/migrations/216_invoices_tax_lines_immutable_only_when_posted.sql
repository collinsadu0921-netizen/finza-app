-- ============================================================================
-- Invoices: tax_lines immutable only when posted (align trigger with intent)
-- ============================================================================
-- The constraint comment says "tax_lines is immutable *once posted*". The
-- original trigger blocked all tax_lines updates. This migration restricts
-- the block to invoices that are already posted (sent or paid), so draft
-- invoice edits can recalculate tax_lines from line items.
--
-- Sales table keeps existing behavior (block all tax_lines changes) unless
-- we define "posted" for sales later.
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_tax_lines_update()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF OLD.tax_lines IS NOT DISTINCT FROM NEW.tax_lines THEN
    RETURN NEW;
  END IF;
  -- tax_lines is being changed
  IF TG_TABLE_NAME = 'invoices' THEN
    -- Invoices: only block when "posted" (sent or paid)
    IF (OLD.status IN ('sent', 'paid')) OR (OLD.sent_at IS NOT NULL) THEN
      RAISE EXCEPTION 'tax_lines JSONB is immutable once posted. Cannot UPDATE tax_lines. Use adjustment journals for corrections.';
    END IF;
  ELSE
    -- Sales and others: preserve original behavior
    RAISE EXCEPTION 'tax_lines JSONB is immutable once posted. Cannot UPDATE tax_lines. Use adjustment journals for corrections.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
