# FINZA FORENSIC ACCOUNTING VERIFICATION REPORT

**READ ONLY — NO MODIFICATIONS — EVIDENCE ONLY**

Run the script `scripts/forensic-accounting-verification.sql` in Supabase SQL Editor. Execute each section (or the full script; if running as one batch, only the last result set is shown — run section by section to capture all). Record results below.

---

## HOW TO INTERPRET RESULTS

| Check ID | 0 rows = PASS | Any rows = FAIL (record details below) |
|----------|----------------|----------------------------------------|
| 1.1_duplicate_invoice_numbers | No duplicate invoice numbers per business | Duplicates exist |
| 1.2_orphan_payments | No payments without valid invoice_id | Orphan payment ids |
| 1.3_paid_invoice_payment_mismatch | All paid invoices: sum(payments) = total | Mismatches |
| 2.1_invoice_missing_ledger | Every invoice has an invoice JE | Invoice ids missing ledger |
| 2.2_payment_missing_ledger | Every payment has a payment JE | Payment ids missing ledger |
| 2.3_je_imbalanced | All journal entries balance (debit = credit) | journal_entry_id with imbalance |
| 3.1_orphan_ledger_lines | No JEL rows with missing account_id | orphan_lines count |
| 3.2_ledger_lines_deleted_account | No JEL referencing deleted accounts | account_id list |
| 4.1_ledger_monthly | (Informational: ledger totals by month) | — |
| 4.2_snapshot_monthly | (Informational: snapshot totals by period) | — |
| 5.1_ar_recon | AR ledger = unpaid invoice sum per business | business_id, amounts |
| 5.2_cash_recon | Cash ledger = net payments − expenses per business | business_id, amounts |
| 5.3_vat_ledger | (Informational: VAT ledger balance per business) | — |
| 6.1_invoice_je_date_mismatch | Invoice JE date = COALESCE(sent_at::date, issue_date) | invoice_id, dates |
| 6.2_payment_je_date_mismatch | Payment JE date = payment.date | payment_id, dates |
| 7.1_vat_ledger_monthly | (Informational: VAT from ledger by month) | — |
| 7.2_vat_returns_monthly | (Informational: VAT from invoices/expenses/bills by month) | — |
| 8.1_snapshot_balanced | is_balanced = true, balance_difference ≈ 0 | period_id, difference |
| 8.2_assets_liab_equity | Assets = Liabilities + Equity (within 0.01) | business_id, discrepancy |

---

## PASS/FAIL SUMMARY

**PASS** = no failure rows for that check. **FAIL** = one or more rows returned. **Not run** = result set not provided in this audit run.

| Area | Result (PASS/FAIL) | Notes |
|------|---------------------|------|
| Document integrity (1.1, 1.2, 1.3) | **FAIL** | 1.1: duplicate invoice numbers (null) in 2 businesses. 1.2, 1.3 not run. |
| Ledger completeness (2.1, 2.2, 2.3) | **FAIL** | 2.3: 8 journal entries with rounding imbalance (debit ≠ credit, diff ≈ 1e-14). 2.1, 2.2 not run. |
| Account integrity (3.1, 3.2) | **PASS** (3.1) | 3.1: 0 orphan ledger lines. 3.2 not run. |
| Snapshot coverage (4.1 vs 4.2) | Not run | — |
| Control reconciliation (5.1, 5.2; 5.3) | Not run | — |
| Period cutoff (6.1, 6.2) | **FAIL** | 6.1: 5 invoices with JE date = issue_date but expected = sent_at::date. 6.2 not run. |
| VAT consistency (7.1 vs 7.2) | Partial | 7.2 evidence only (operational VAT by month). 7.1 not run; no side-by-side. |
| Global accounting invariant (8.1, 8.2) | Not run | — |

---

## FOR EACH FAILURE PROVIDE

*(Record only where a check returned rows.)*

### Document integrity
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| invoice_number = null, cnt 2; invoice_ids d1b3f43a-7c0f-4aad-8f1e-28e7bcfc6f55, 42ba4d62-8c9b-4d92-87ca-99b7798c8958 | — | — | — | 4e47aff3-dee1-48ed-9023-15b9658c9e47 |
| invoice_number = null, cnt 4; invoice_ids cb853898-e542-4422-87a8-41c74206505b, 9647b4ed-f4f4-417d-8e30-af72a7b4a614, 99147c68-bf44-42c8-b294-6dbe1e1e7361, eeb988d6-9ada-46cb-9a46-0d209443aaab | — | — | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |

### Ledger completeness
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| journal_entry_id df64a5c7-cca3-4f7b-a694-ce7049b210eb | 0.00000000000001 (1000 vs 999.99…) | — | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |
| journal_entry_id 696946b8-43f1-4c74-ba79-10e65aa2f795 | 0.00000000000001 | — | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |
| journal_entry_id af4677d9-2d13-4c50-9dfb-d47786379bc3 | 0.00000000000001 | — | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |
| journal_entry_id b88957e5-632c-4467-a061-409c04b9bd37 | 0.00000000000001 | — | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| journal_entry_id 5cd9a968-56d9-4af1-bf85-0a6d843f89ee | 0.000000000000005 | — | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| journal_entry_id 82001e7c-ce1c-45e3-8d4f-0ba2129ad262 | -0.000000000000002 | — | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| journal_entry_id 35376109-9a2f-4026-afdc-6edc570ce2d9 | 0.000000000000005 | — | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| journal_entry_id e9463f3c-e2da-487a-861e-99c682c2b831 | -0.000000000000002 | — | — | d1098106-d623-4d8a-80e5-e24fd216199b |

### Account integrity
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| — | — | — | — | 3.1 PASS: orphan_lines = 0. 3.2 not run. |

### Snapshot coverage
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| Not run | — | — | — | — |

### Control reconciliation
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| Not run | — | — | — | — |

### Period cutoff
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| invoice_id 5f11eebb-239f-4518-80b1-6d32484077a6 | expected_je_date 2025-12-11, actual_je_date 2025-12-08 | 2025-12 | — | 3f3c8d3a-8f7d-4b8d-82b3-0255d2f5f869 |
| invoice_id 1cb139c0-f391-4060-ae82-bf5fb3082b15 | expected 2025-12-11, actual 2025-12-08 | 2025-12 | — | 3f3c8d3a-8f7d-4b8d-82b3-0255d2f5f869 |
| invoice_id 51422a0d-f00e-4dcb-b1d5-f00907e1a75e | expected 2025-12-13, actual 2025-12-10 | 2025-12 | — | 3f3c8d3a-8f7d-4b8d-82b3-0255d2f5f869 |
| invoice_id b27e86b1-c042-46fc-a7f0-61c5a58745cc | expected 2026-01-26, actual 2026-01-20 | 2026-01 | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |
| invoice_id 2160fdc8-ac9f-4b67-8290-2de476a8adab | expected 2026-01-27, actual 2026-01-19 | 2026-01 | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |

### VAT consistency
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| (7.2 only — operational VAT by month; 7.1 not run for comparison) | — | — | — | — |
| business_id, period_month 2025-12-01 | output_vat 10310.86, input_vat 18355.69, net_vat -8044.83 | 2025-12 | — | 3f3c8d3a-8f7d-4b8d-82b3-0255d2f5f869 |
| business_id, period_month 2026-01-01 | output_vat 24.99, input_vat 0, net_vat 24.99 | 2026-01 | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| business_id, period_month 2026-02-01 | output_vat 162.51, input_vat 137.5, net_vat 25.01 | 2026-02 | — | 4a50badb-60ad-4f4d-8e0f-9f4918ebec4b |
| business_id, period_month 2026-02-01 | output_vat 12.51, input_vat 0, net_vat 12.51 | 2026-02 | — | d1098106-d623-4d8a-80e5-e24fd216199b |
| business_id, period_month 2026-01-01 | output_vat 1505.76, input_vat 2125, net_vat -619.24 | 2026-01 | — | fc46f731-a3e0-4051-a5c4-3921f4521f0c |

### Global accounting invariant
| Record identifiers | Amount discrepancy | Period | Account code | Business id |
|--------------------|--------------------|--------|--------------|-------------|
| Not run | — | — | — | — |

---

## EVIDENCE SUMMARY

| Check | Rows returned | Verdict |
|-------|----------------|--------|
| 1.1 Duplicate invoice numbers | 2 | FAIL: 2 businesses with duplicate `invoice_number` (null); 2 and 4 invoice ids each. |
| 2.3 JE imbalanced | 8 | FAIL: Floating-point rounding; difference ≈ ±1e-14 to 5e-15. |
| 3.1 Orphan ledger lines | 1 row, orphan_lines = 0 | PASS. |
| 6.1 Invoice JE date mismatch | 5 | FAIL: JE posted with `issue_date` instead of `COALESCE(sent_at::date, issue_date)`. |
| 7.2 VAT returns monthly | 5 | Informational (operational source); no 7.1 ledger comparison in this run. |

*Checks 1.2, 1.3, 2.1, 2.2, 3.2, 4.1, 4.2, 5.1, 5.2, 5.3, 6.2, 7.1, 8.1, 8.2: result sets not provided.*

---

*End of forensic accounting verification report. Evidence only; no fixes or recommendations.*
