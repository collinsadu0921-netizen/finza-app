-- Repair known mojibake in stored currency symbols.
--
-- UTF-8 cedi (U+20B5) has been stored after being decoded as Windows-1252
-- (E2 82 B5) and as CP850 (D4 E9 C1). Amounts, tax totals, ledger entries,
-- and document numbering are deliberately untouched.

UPDATE public.invoices
SET currency_symbol = U&'\20B5'
WHERE upper(coalesce(currency_code, '')) = 'GHS'
  AND currency_symbol IN (
    U&'\00E2\201A\00B5',
    U&'\00D4\00E9\00C1',
    U&'\00C2\20B5'
  );

UPDATE public.bills
SET currency_symbol = U&'\20B5'
WHERE upper(coalesce(currency_code, '')) = 'GHS'
  AND currency_symbol IN (
    U&'\00E2\201A\00B5',
    U&'\00D4\00E9\00C1',
    U&'\00C2\20B5'
  );

UPDATE public.expenses
SET currency_symbol = U&'\20B5'
WHERE upper(coalesce(currency_code, '')) = 'GHS'
  AND currency_symbol IN (
    U&'\00E2\201A\00B5',
    U&'\00D4\00E9\00C1',
    U&'\00C2\20B5'
  );

UPDATE public.estimates
SET currency_symbol = U&'\20B5'
WHERE upper(coalesce(currency_code, '')) = 'GHS'
  AND currency_symbol IN (
    U&'\00E2\201A\00B5',
    U&'\00D4\00E9\00C1',
    U&'\00C2\20B5'
  );

UPDATE public.proforma_invoices
SET currency_symbol = U&'\20B5'
WHERE upper(coalesce(currency_code, '')) = 'GHS'
  AND currency_symbol IN (
    U&'\00E2\201A\00B5',
    U&'\00D4\00E9\00C1',
    U&'\00C2\20B5'
  );
