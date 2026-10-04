-- Sales history reference search.
-- sales.payment_lines is jsonb, but checkout stores a JSON string inside it.
-- Array containment does not match that shape and is not used here.
-- payment_lines_search is the plain text of those lines: unwrap a jsonb string,
-- otherwise render the jsonb value. Sales history ilike-filters this column.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_lines_search text
  GENERATED ALWAYS AS (
    CASE
      WHEN payment_lines IS NULL THEN NULL
      WHEN jsonb_typeof(payment_lines) = 'string' THEN payment_lines #>> '{}'
      ELSE payment_lines::text
    END
  ) STORED;

COMMENT ON COLUMN public.sales.payment_lines_search IS
  'Plain text of payment_lines for sales-history reference search.';

NOTIFY pgrst, 'reload schema';
