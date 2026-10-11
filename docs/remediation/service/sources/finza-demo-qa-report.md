Finza Demo – Accounting QA Report (10 Oct 2026)
Account: Finza Demo (support@finza.africa), GHS. Tested like a small business: sales, purchases, stock, payroll, tax, reports.
What works
- Invoices, part payments and credit notes post correctly to cash, receivables, revenue and VAT/NHIL/GETFund.
- Overpayments are blocked on both customer invoices and supplier bills.
- Expenses and supplier bills (incl. input tax) post correctly.
- Balance sheet always balanced; Cash Flow closing cash = balance sheet cash.
- PAYE and SSNIT correct for normal salaries (3,000 and 1,000 checked against Ghana bands).
Critical (wrong numbers / broken accounting)
1. Trial Balance shows 0.00 for every account but says "Balanced" (custom range 2026 and period 2026-10).
2. Stock: buying (800) and using (240) QA Cement never posted to inventory, cost of sales, cash or payables.
3. Changes in Equity (Oct): opening 0, closing 5,041.67; balance sheet equity is 345.26.
4. VAT Filings (Oct): output 583.34 - input 575.01 = 8.33, but net shown 6.25; output should be ~250.
5. Payroll "test" employee: SSNIT on 100 basic shows 32.33 (employee) / ~76.41 (employer) instead of 5.50 / 13.00.
6. 2026 P&L carries payroll expense equal to the unapproved Oct draft run (4,100 + 596.41).
7. Bank Reconciliation: system balance -5,200 vs ledger cash +2,027.50 (sign reversed); picker lists non-bank accounts (AR, Fixed Assets, WHT Receivable).
8. Quote QUO-0001 converted to an invoice twice in the same minute, creating two invoices.
9. Credit note page: on a 2,000 invoice with 1,000 paid, CN shows paid 0, remaining 2,000, balance after 1,500 (should be 1,000 / 500).
10. Credit note form ignores payments: allows crediting full 2,000 when 1,000 is owed.
11. Two July 2026 salary runs exist for the same period.
Blocking workflow bugs
12. Payroll Approve fails: PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED (missing TIN/GRA position), though the page says you can still approve.
13. Quote with a material line can't be saved: requires "supply mode" but has no control for it.
14. Quote email to a bad address failed, yet status became Sent.
15. No general manual journal entry; owner capital only via Loans & Equity.
Display / UX bugs
16. Dashboard figures stale until Refresh, though labelled "Based on ledger records".
17. Dashboard lists the 5,000 owner contribution as "Expense recorded".
18. Dashboard "Latest period" showed July although October was active.
19. Supplier Bills list "Total Paid 0.00" while QA-BILL-001 has 500 paid.
20. Issue invoice dialog hangs on "Issuing…" though it issued.
21. Customer dropdown: typing to search does nothing; first click often ignored.
22. Payroll showed 0 eligible employees until reload.
23. Quotes sidebar link crashed the app once.
24. "Subtotal" means gross on the new-invoice form but pre-tax on the saved invoice.
25. "Issue Credit Note" offered on an unnumbered draft invoice.
26. Period lists disagree: 2026-01 shows in Periods/Cash Flow/Equity but not TB/BS/P&L.
27. Period end dates shown as "12:00 am" on the last day.
28. Tax rounding: 2,000 incl. tax gives base 1,666.66 (exact 1,666.67).
Incomplete / placeholder
- Reconciliation page is empty.
- Prices are tax-inclusive only; no exclusive option.
- No COVID levy option although the account exists; service "Tax code" is free text.
- E-VAT and VAT filing are internal drafts only; nothing submitted to GRA.
- No automatic CIT provision; Withholding Tax register empty; DT 107A export "verification only".
- Employer SSNIT not shown per employee on payroll lines.
QA records left in the demo
Service QA Consulting; customer QA Customer Ltd; INV-000003 (2,000, due 500); 1,000 cash payment; CN-0003 (-500); QA Office supplies expense (300); QA Supplier Ltd + QA-BILL-001 (1,150, due 650); QA Cement; recurring invoice; quote QUO-0001 and its invoice(s); owner contribution 5,000; QA Employee (3,000); draft Oct 2026 payroll run (not approved, nothing paid)
