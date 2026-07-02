-- Staging verification for migration 510 (project adonhhtooawkeemdqqeo only)

SELECT proname FROM pg_proc
WHERE proname IN ('get_operational_overdue_invoices_page', 'get_bills_list_page')
ORDER BY proname;

SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'idx_payments_business_invoice',
  'idx_payments_invoice_id',
  'idx_invoices_business_status_due_date',
  'idx_bill_payments_bill_id',
  'idx_payroll_runs_business_month_desc'
)
ORDER BY indexname;

-- Smoke RPC (replace business id):
-- SELECT get_operational_overdue_invoices_page('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid, 25, 0, NULL, NULL, NULL, NULL);
-- SELECT get_bills_list_page('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid, 50, 0, NULL, NULL, NULL, NULL, NULL);
