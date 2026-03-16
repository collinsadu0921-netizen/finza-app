# FINZA — Table Inventory (RLS, business_id, Policies) & Write Endpoints

Generated from migrations and `app/api` route handlers. Structural reference only.

---

## 1. Table inventory (RLS | business_id | Policies S/I/U/D)

Policies: **S** = SELECT, **I** = INSERT, **U** = UPDATE, **D** = DELETE.  
`business_id`: **Y** = table has `business_id` column; **N** = no; **via** = scoped only via parent FK.

| Table | RLS | business_id | Policies |
|-------|-----|-------------|----------|
| accounts | Y | Y | S I (U/D denied by design for system; non-system have U D) |
| accounting_adjustment_audit | — | Y | — |
| accounting_adjustments | — | Y | — |
| accounting_balances | Y | Y | S I U |
| accounting_firm_activity_logs | Y | N (firm_id) | S I (U/D deny) |
| accounting_firm_clients | Y | N | S |
| accounting_firm_users | Y | N | S I |
| accounting_firms | Y | N | S I |
| accounting_invariant_failures | Y | Y | — |
| accounting_invariant_runs | — | Y | — |
| accounting_opening_balances | — | Y | — |
| accounting_period_actions | — | Y | — |
| accounting_periods | Y | Y | S I U D |
| adjustment_journals | Y | Y | — |
| afs_documents | Y | Y | S I |
| afs_runs | Y | Y | S I U |
| allowances | Y | via staff | S I U D |
| assets | Y | Y | S I U D |
| audit_logs | Y | Y | S I |
| backfill_audit_log | — | Y | — |
| bank_transactions | Y | Y | S I U D |
| bill_items | Y | via bills | S I U D |
| bill_payments | Y | Y | S I U D |
| bills | Y | Y | S I U D |
| business_reminder_settings | Y | Y | S I U (no D in 039) |
| business_whatsapp_templates | Y | Y | — |
| businesses | Y | N (owner_id) | S I U (later migrations) |
| business_users | — | Y | — |
| carry_forward_batches | — | Y | — |
| carry_forward_lines | — | — | — |
| cash_drops | — | Y | — |
| cashier_sessions | — | Y | S I U D (030) |
| categories | Y | Y | S I U D |
| chart_of_accounts | Y | Y | — |
| chart_of_accounts_control_map | Y | Y | — |
| clients | Y | Y | S I U D |
| coa_mapping_schemes | Y | Y | — |
| credit_note_items | Y | via credit_notes | S I U D |
| credit_notes | Y | Y | S I U D |
| customer_notes | — | Y | — |
| customers | Y | Y | S I U (193; D may exist elsewhere) |
| deductions | Y | via staff/payroll | S I U D |
| depreciation_entries | Y | Y | S I U D |
| estimate_items | Y | via estimates | S I U D |
| estimates | Y | Y | S I U D |
| expense_categories | Y | Y | S I U D |
| expenses | Y | Y | S I U D |
| firm_client_engagements | Y | N (client_business_id etc.) | S I U (155, 277) |
| internal_alerts | — | Y | — |
| invoice_items | Y | via invoices | S I U D |
| invoice_reminders | Y | Y | S I U D |
| invoice_settings | Y | Y | S I U |
| invoices | Y | Y | S I U D |
| items | — | Y | — |
| journal_entries | Y | Y | S I (no U/D; trigger blocks) |
| journal_entry_lines | Y | via journal_entries | S I (no U/D; trigger blocks) |
| layaway_plans | Y | Y | — |
| layaway_payments | Y | Y | — |
| ledger_adjustment_approvals | Y | Y | S I |
| ledger_adjustment_policy | Y | Y | S |
| ledger_entries | Y | Y | S I |
| manual_journal_drafts | Y | Y | S I U D (147, 293) |
| offline_transactions | Y | Y | S I U |
| opening_balance_batches | — | Y | — |
| opening_balance_imports | Y | Y | — |
| opening_balance_lines | — | — | — |
| order_items | Y | via orders | S I U D |
| orders | Y | Y | S I U D |
| overrides | — | Y | — |
| parked_sales | — | Y | — |
| period_account_snapshot | Y | Y | — |
| period_close_attempts | — | Y | — |
| period_closing_balances | Y | Y | — |
| period_opening_balances | Y | Y | — |
| period_summary | Y | Y | — |
| product_modifiers | Y | via product | S I U D |
| products | Y | Y | S I U D |
| products_services | Y | Y | S I U D |
| products_stock | Y | Y | S I U D |
| products_variants | Y | via products | S I U D |
| purchase_order_items | Y | via purchase_orders | S I U D |
| purchase_orders | Y | Y | S I U D |
| quick_keys | — | Y | — |
| receipt_sends | Y | Y | — |
| receipt_settings | Y | Y | — |
| reconciliation_periods | Y | Y | S I U D |
| reconciliation_resolutions | — | — | — |
| registers | Y | Y | S I U D |
| retail_posting_debug_log | — | Y | — |
| rider_deliveries | — | — | — |
| rider_payouts | — | — | — |
| riders | — | — | — |
| sale_items | Y | via sales | S I U D |
| sales | Y | Y | S I U D |
| staff | Y | Y | S I U D |
| stock_history | Y | Y | S I U D |
| stock_movements | Y | Y | S I U D |
| stock_transfer_items | Y | via stock_transfers | S I U D |
| stock_transfers | Y | Y | S I U |
| stores | Y | Y | S I U D |
| supplier_invoices | Y | Y | S I U |
| supplier_payments | Y | Y | S I |
| suppliers | Y | Y | S I U |
| trial_balance_snapshots | Y | Y | S (237); I/U (239) |
| vat_returns | Y | Y | S I U D |

*Note: Later migrations may add or drop policies; journal_entries / journal_entry_lines have no UPDATE/DELETE policies and triggers enforce append-only.*

---

## 2. Write endpoints (POST / PUT / PATCH / DELETE)

Routes under `app/api` that export a write handler. Path is relative to `/api`.

| Method | Path |
|--------|------|
| POST | accounting/adjustments/apply |
| POST | accounting/carry-forward/apply |
| POST | accounting/firm/bulk/afs/finalize |
| POST | accounting/firm/bulk/preflight |
| POST | accounting/firm/clients/add |
| POST | accounting/firm/engagements |
| PATCH | accounting/firm/engagements/[id] |
| PATCH | accounting/firm/engagements/[id]/status |
| POST | accounting/firm/onboarding/complete |
| POST | accounting/initialize |
| POST | accounting/journals/drafts |
| PATCH | accounting/journals/drafts/[id] |
| DELETE | accounting/journals/drafts/[id] |
| POST | accounting/journals/drafts/[id]/post |
| POST | accounting/opening-balances |
| PATCH | accounting/opening-balances/[id] |
| POST | accounting/opening-balances/[id]/approve |
| POST | accounting/opening-balances/[id]/post |
| POST | accounting/opening-balances/apply |
| PATCH | accounting/opening-balances/[id] |
| POST | accounting/periods/close |
| POST | accounting/periods/reopen |
| POST | accounting/reversal |
| POST | accounting/reconciliation/resolve |
| POST | accounting/afs/[run_id]/finalize |
| PATCH | admin/accounting/forensic-failures/[id]/acknowledge |
| PATCH | admin/accounting/forensic-failures/[id]/ignore |
| POST | admin/accounting/forensic-failures/[id]/escalate |
| PATCH | admin/accounting/forensic-failures/[id]/resolve |
| PATCH | admin/accounting/tenants/[id]/archive |
| PATCH | admin/accounting/tenants/[id]/reactivate |
| POST | alerts (PUT) |
| POST | assets/create |
| POST | assets/[id]/depreciation |
| POST | assets/[id]/dispose |
| PUT | assets/[id] |
| DELETE | assets/[id] |
| POST | auth/pin-login |
| POST | audit-logs/login |
| POST | automations/[id] (PUT) |
| POST | bills/create |
| PUT | bills/[id] |
| DELETE | bills/[id] |
| POST | bills/[id]/payments |
| PUT | bills/[id]/payments/[paymentId] |
| DELETE | bills/[id]/payments/[paymentId] |
| PATCH | business/profile |
| PUT | business/profile |
| POST | accounts/create |
| PUT | accounts/[id] |
| DELETE | accounts/[id] |
| POST | accounts/year-end-close |
| POST | credit-notes/create |
| PUT | credit-notes/[id] |
| POST | credit-notes/[id]/send |
| POST | customers |
| PATCH | customers/[id] |
| POST | customers/[id]/notes |
| PUT | customers/[id]/tags |
| POST | expense-categories |
| PUT | expense-categories/[id] |
| DELETE | expense-categories/[id] |
| POST | expenses/create |
| PUT | expenses/[id] |
| DELETE | expenses/[id] |
| POST | expenses/categories |
| POST | estimates/create |
| POST | estimates/[id]/convert |
| PUT | estimates/[id] |
| POST | estimates/[id]/send |
| POST | firm/accounting-clients |
| POST | invoice-settings (PUT) |
| POST | invoices/create |
| POST | invoices/[id]/mark-paid |
| POST | invoices/[id]/send |
| POST | invoices/[id]/unsent |
| PUT | invoices/[id] |
| DELETE | invoices/[id] |
| POST | invoices/preview-draft |
| POST | invoices/preview |
| POST | layaway/payments |
| POST | offline/sync |
| POST | onboarding/retail/finalize |
| POST | orders/create |
| POST | orders/convert-from-estimate |
| PATCH | orders/[id] |
| POST | orders/[id]/convert-to-invoice |
| POST | orders/[id]/send |
| POST | override/discount |
| POST | override/refund-sale |
| POST | override/void-sale |
| POST | payroll/runs |
| PUT | payroll/runs/[id] |
| POST | payroll/runs/[id]/generate-payslips |
| POST | payments/create |
| PUT | payments/[id] |
| DELETE | payments/[id] |
| POST | payments/hubtel |
| POST | payments/momo |
| POST | payments/momo/callback |
| POST | payments/momo/initiate |
| POST | payments/webhooks/mobile-money |
| POST | products/create-service |
| POST | products/sync-to-services |
| POST | purchase-orders |
| POST | purchase-orders/[id]/receive |
| POST | purchase-orders/[id]/send |
| POST | reconciliation/[accountId]/auto-match |
| POST | reconciliation/[accountId]/ignore |
| POST | reconciliation/[accountId]/import |
| POST | reconciliation/[accountId]/match |
| POST | reconciliation/[accountId]/periods |
| POST | reconciliation/[accountId]/unmatch |
| PUT | reconciliation/accounts |
| POST | receipt-ocr |
| POST | receipts/send |
| POST | recurring-invoices/create |
| PUT | recurring-invoices/[id] |
| DELETE | recurring-invoices/[id] |
| POST | recurring-invoices/generate |
| POST | register/close |
| POST | register/override |
| POST | reminders/due-date |
| PUT | reminders/settings |
| POST | reminders/overdue |
| POST | reminders/process-automated |
| POST | sales/create |
| POST | sales/park |
| POST | service/accounting/post-intent |
| PATCH | service/engagements/[id] |
| POST | settings/whatsapp-template |
| POST | staff/create |
| POST | staff/create-system-user |
| POST | staff/[id]/allowances |
| PUT | staff/[id]/allowances/[allowanceId] |
| DELETE | staff/[id]/allowances/[allowanceId] |
| POST | staff/[id]/deductions |
| PUT | staff/[id]/deductions/[deductionId] |
| DELETE | staff/[id]/deductions/[deductionId] |
| PUT | staff/[id] |
| DELETE | staff/[id] |
| POST | stock-transfers |
| POST | stock-transfers/[id]/cancel |
| POST | stock-transfers/[id]/receive |
| POST | stock-transfers/[id]/send |
| POST | storage/create-bucket |
| POST | supplier-payments |
| POST | suppliers |
| PATCH | suppliers/[id] |
| PUT | users/[id]/store |
| POST | vat-returns/calculate |
| POST | vat-returns/create |
| PUT | vat-returns/[id] |
| POST | whatsapp/disconnect |
| POST | control-tower/log-activity |
| POST | cron/forensic-accounting-verification |

*(Read-only routes and GET exports are omitted.)*
