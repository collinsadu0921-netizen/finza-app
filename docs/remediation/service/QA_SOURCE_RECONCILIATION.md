# Finza Service — QA source reconciliation

Status date: 11 October 2026. Evidence management only. No application code, test, migration, database, or deployment was changed.

## 1. Source document

The file `finza-demo-qa-report.md` was not found as a pre-existing file in the project tree. The owner supplied the report text in the reconciliation request on 11 October 2026. That text is preserved unchanged at `docs/remediation/service/sources/finza-demo-qa-report.md`. It was not rewritten from an earlier summary.

The report is titled "Finza Demo – Accounting QA Report (10 Oct 2026)". The account named in it is Finza Demo, `support@finza.africa`, currency GHS. The report does not include click-by-click reproduction steps. Where an expected result is not written as a sentence, this reconciliation says "not stated".

Prior production reads in the master register were not identified as this login. A failed lookup on a different business does not clear a QA example, and it does not prove the example.

## 2. Total original QA findings

34 defect observations:

- 28 numbered items
- 6 incomplete or placeholder bullets

Five "what works" observations are recorded below and are not defects. The closing list of QA records left in the demo is context, not a separate finding.

## 3. Findings matched to the register

1 matched.

| QA | Reported behavior | Expected behavior in the report | Register | Evidence already held | Status |
|---|---|---|---|---|---|
| 7 | System balance -5,200 versus ledger cash +2,027.50. Picker lists accounts receivable, fixed assets, and withholding-tax receivable. | Not stated as a target balance. The report calls the sign reversed and names non-bank accounts. | BNK-001 | Code reads every asset and treats a bank debit as a decrease. The cedis were not remeasured. | CONFIRMED for the mechanism. Amounts remain QA-reported. |

## 4. Partially matched findings

9 partially matched. The register covers part of the report. The QA example is not confirmed, and nothing is treated as fixed.

| QA | Reported behavior | Expected behavior | Register | Gap |
|---|---|---|---|---|
| 1 | Trial balance 0.00 for every account, labelled Balanced, for custom range 2026 and period 2026-10. | Not stated. | FIN-001, FIN-002, FIN-006 | FIN-001 is the custom-range code path. FIN-002 is the zero-equals-balanced label. FIN-006 stays NOT REPRODUCED: the snapshot that was read was stale and non-zero, and it was not tied to this login. |
| 2 | Buying 800 and using 240 of QA Cement posted nothing to inventory, cost of sales, cash, or payables. | Not stated as journal lines. The report says those postings never happened. | MAT-001, MAT-002, MAT-003 | MAT-001 is a usage trigger that posts only on a status update. It does not explain a missing purchase. MAT-002 is a different cement row, quantity 1,815. MAT-003 holds the QA quantities and is REPORTED. |
| 3 | October equity opening 0, closing 5,041.67. Balance sheet equity 345.26. | Not stated. The two figures are presented as the defect. | FIN-004 | The code uses different earnings windows. The QA cedis were not re-calculated. |
| 4 | Output 583.34 minus input 575.01 equals 8.33, net shown 6.25, output should be about 250. | Net implied by the subtraction is 8.33. Output "should be ~250". | TAX-001, TAX-003, TAX-004 | TAX-001 is liability debits treated as input tax. It was not recomputed against these figures. TAX-003 and TAX-004 hold the two QA clauses and are REPORTED. |
| 5 | Test employee, basic 100, SSNIT 32.33 employee and about 76.41 employer. | 5.50 and 13.00. | PRL-002 | Stays NOT REPRODUCED for rows that were not identified as this employee. The normal-salary note (3,000 and 1,000) is a separate positive observation. |
| 6 | 2026 profit and loss includes the unapproved October draft, 4,100 + 596.41. | Not stated. The draft is described as not approved and nothing paid. | PRL-001, PRL-005 | PRL-001 is the unguarded post function, CONFIRMED in code. PRL-005 stays NEEDS REPRODUCTION. The 10 October count found no draft run with a journal, on a check not tied to this login. |
| 8 | QUO-0001 converted twice in the same minute. | Not stated. Two invoices are the reported result. | DOC-001 | The convert route can race. CONFIRMED in code. The two invoices were not counted. One QUO-0001 later read as rejected, total 3,950, and not converted, was not shown to be this quote. |
| 11 | Two July 2026 salary runs for the same period. | Not stated. | PRL-003 | Stays NOT REPRODUCED. One July run was found on a check not tied to this login. |
| 12 | Approve fails with `PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED` for missing TIN/GRA position. The page says the user can still approve. | Not stated beyond the error. | PRL-004 | Stays NEEDS REPRODUCTION. The function raises inside the approval transaction. The UI sentence was not checked. |

## 5. Missing findings added

22 QA observations were not in the register as their own entries. They are now REPORTED. They are not confirmed.

| QA | Reported behavior | Expected behavior | New ID | Package |
|---|---|---|---|---|
| 9 | Credit-note page on a 2,000 invoice with 1,000 paid shows paid 0, remaining 2,000, balance after 1,500. | 1,000 and 500. | INV-003 | C |
| 10 | Form allows a credit of 2,000 when 1,000 is owed. | Not stated. The report says the form ignores payments. | INV-004 | C |
| 13 | Material quote cannot be saved. Supply mode is required and there is no control. | Not stated. | DOC-002 | G |
| 14 | Email to a bad address failed, and status became Sent. | Not stated. | DOC-003 | G |
| 15 | No general manual journal. Owner capital only through Loans & Equity. | Not stated. | DOC-004 | G |
| 16 | Dashboard figures stay stale until Refresh. Label says "Based on ledger records". | Not stated. | UI-001 | G |
| 17 | Dashboard lists the 5,000 owner contribution as "Expense recorded". | Not stated. | UI-002 | G |
| 18 | Latest period showed July although October was active. | Not stated. | UI-003 | D |
| 19 | Supplier bills list Total Paid 0.00. QA-BILL-001 has 500 paid. | Not stated. Residual note: bill 1,150, due 650. | UI-004 | G |
| 20 | Issue dialog stays on "Issuing…" after the invoice issued. | Not stated. | UI-005 | G |
| 21 | Customer search does nothing. First click often ignored. | Not stated. | UI-006 | G |
| 22 | Payroll showed 0 eligible employees until reload. | Not stated. | UI-007 | G |
| 23 | Quotes sidebar crashed the app once. No error text. | Not stated. | UI-008 | G |
| 24 | Subtotal means gross on the new invoice and pre-tax on the saved invoice. | Not stated. | UI-009 | G |
| 25 | Issue Credit Note is offered on an unnumbered draft. | Not stated. | UI-010 | C |
| 26 | Period 2026-01 is on Periods, Cash Flow, and Equity, and not on trial balance, balance sheet, or profit and loss. | Not stated. | FIN-007 | D |
| 27 | Period end shows as "12:00 am" on the last day. | Not stated. | UI-011 | G |
| 28 | Tax-inclusive 2,000 gives base 1,666.66. | 1,666.67. | TAX-005 | E |
| Incomplete | Prices are tax-inclusive only. | An exclusive option. Not stated as a formula. | TAX-006 | E |
| Incomplete | E-VAT and VAT filing are internal drafts. Nothing submitted to GRA. | Not stated. | TAX-008 | E |
| Incomplete | No automatic CIT provision. Withholding-tax register empty. DT 107A export is verification only. | Not stated. | TAX-009, TAX-010, PRL-007 | E |
| Incomplete | Employer SSNIT is not shown per employee on payroll lines. | Not stated. | PRL-006 | E |

Three further IDs were added for scope that the partial matches did not cover: MAT-003 (QA 2), TAX-003 and TAX-004 (QA 4). That is 29 new register IDs.

QA items 9 and 10 are not INV-001. INV-001 is a full credit stored and shown as paid. The QA credit note left in the demo is CN-0003 for -500 on INV-000003.

## 6. Duplicate findings

QA-001 was a single blocked bucket for items 13, 14, and 16–28. It is now an index. It is not a second defect and it is not a work item. Status changed from BLOCKED to REPORTED because the source text arrived. It was not closed.

No numbered QA item is a duplicate of another numbered QA item.

## 7. Findings requiring clarification

| QA | Conflict | Register |
|---|---|---|
| Incomplete, "Reconciliation page is empty." | QA item 7 describes a bank reconciliation that shows -5,200 and +2,027.50. An empty page and a populated wrong balance may be two screens. | BNK-002, beside BNK-001 |
| Incomplete, no COVID levy option, tax code is free text. | TAX-002 is a net-payable formula that omits COVID from 2026. The report does not say the formula is wrong. It says the option is missing and the code is free text. | TAX-007, beside TAX-002 |

DOC-004, TAX-006, TAX-008, TAX-009, and PRL-007 need a product decision before anyone treats them as defects to build.

## 8. Differences between the QA observations and production evidence

These differences are unresolved. They are not corrections.

- The QA login is `support@finza.africa`. Earlier reads were not identified as that login.
- QA CN-0003 is -500 on INV-000003 (2,000, due 500, plus a 1,000 cash payment). The production credit incident used a different CN-0003 amount and a different invoice. They are not the same document.
- QA QUO-0001 was converted twice. A quote numbered QUO-0001 was later read as rejected, total 3,950, and not converted. Same number does not prove same row.
- QA Cement is a buy of 800 and a use of 240 with no postings. A cement stock row of quantity 1,815 and average cost 89 was a different observation.
- QA item 1 is an all-zero trial balance. The October snapshot that was read was stale and non-zero.
- QA item 11 is two July runs. One July run was found on the earlier check.
- QA item 5 is SSNIT 32.33 and about 76.41 on basic 100. The earlier payroll read did not identify that employee. About 76.41 is approximate.
- QA item 6 is profit and loss of 4,100 + 596.41 from an unapproved draft. The earlier count of draft runs with a journal was zero, on a check not tied to this login.
- The report says the balance sheet balanced and cash-flow closing cash equalled balance sheet cash. FIN-004 is the equity statement versus the balance sheet, which QA item 3 also reports. FIN-005 remains a code path when withholding-tax receivable moves. The positive observation does not clear FIN-005.
- The report says invoices, part payments, and credit notes posted correctly. That does not clear INV-001, INV-003, or INV-004.
- The report says supplier bills posted correctly, and also that the bills list shows Total Paid 0.00 while 500 was paid. UI-004 holds the list discrepancy. It is not confirmed.
- Output "should be ~250" has no worksheet in the report.

No production query was run for this reconciliation.

## 9. Remaining verification gaps

- Every REPORTED entry.
- FIN-006, PRL-002, PRL-003, and MAT-002, because the earlier negative checks were not tied to `support@finza.africa`.
- PRL-004 and PRL-005, still NEEDS REPRODUCTION, now with the QA amounts and the TIN/GRA detail.
- TAX-002, still NEEDS REPRODUCTION, and it is not the same question as TAX-007.
- BNK-001 amounts -5,200 and +2,027.50.
- FIN-004 amounts 5,041.67 and 345.26.
- DOC-001's two invoices from QUO-0001.
- The QA records listed at the end of the report were not opened in this pass: Service QA Consulting, QA Customer Ltd, INV-000003, the 1,000 payment, CN-0003 of -500, the 300 expense, QA Supplier Ltd, QA-BILL-001, QA Cement, the recurring invoice, QUO-0001, the 5,000 contribution, QA Employee at 3,000, and the unapproved October draft.

## 10. Release-package mapping

| Package | QA coverage added or linked | Change |
|---|---|---|
| A | None | Unchanged. Payment security is not in the QA report. |
| B | None | Unchanged. |
| C | QA 9, 10, 25 | INV-003, INV-004, UI-010 added as REPORTED. INV-001 stays the production full-credit case. |
| D | QA 1, 3, 18, 26 | FIN-007 and UI-003 added as REPORTED. FIN-001, FIN-002, FIN-004, and FIN-006 keep their statuses. |
| E | QA 4, 5, 6, 11, 12, 28, and the tax and payroll incomplete bullets | TAX-003 through TAX-010, PRL-006, and PRL-007 added as REPORTED. Existing payroll statuses were not upgraded. |
| F | QA 2, 7, and the empty reconciliation page | MAT-003 and BNK-002 added as REPORTED. BNK-001 stays CONFIRMED for the mechanism. Shared bank and stock edits stay unauthorized. |
| G | QA 8, 13, 14, 15, 16, 17, 19–24, 27 | DOC-002, DOC-003, DOC-004, and the listed UI IDs added as REPORTED. QA-001 is an index. DOC-004 is not authorized. |

## Positive observations

These are not defects and were not added to the register.

| Observation | Register note |
|---|---|
| Invoices, part payments, and credit notes post to cash, receivables, revenue, and VAT/NHIL/GETFund. | Does not clear INV-001, INV-003, or INV-004. |
| Overpayments are blocked on customer invoices and supplier bills. | No opposing defect is registered. |
| Expenses and supplier bills, including input tax, post correctly. | Does not clear UI-004. LED-003 stays a non-reproduced expense-duplicate claim. |
| Balance sheet always balanced. Cash-flow closing cash equals balance sheet cash. | Compatible with FIN-004, which is the equity statement. Does not clear FIN-005. |
| PAYE and SSNIT are correct for salaries of 3,000 and 1,000. | Context for PRL-002, which is the basic-100 exception. |

## Counts

| Item | Count |
|---|---|
| Previous register entries | 34 |
| QA defect observations | 34 |
| Matched | 1 |
| Partially matched | 9 |
| Missing, then added | 22 |
| Needs clarification | 2 |
| New register IDs | 29 |
| Updated register entries | 63 |
| Moved to VERIFIED, RELEASED, or CLOSED | 0 |
