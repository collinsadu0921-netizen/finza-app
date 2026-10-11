# Finza Service — Release plan

Status date: 11 October 2026. This plan does not authorize implementation, a migration apply, or a deployment.

Production remains `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` on `app.finza.africa`, built from `ee5cdb2256b59baccf85a598fbc53e083153e53b`. Package A exists only as uncommitted files on `fix/prod-payment-authorization`.

Retail is out of every package. A package that needs a shared function, shared table, or shared screen stops for architectural review. That review is not an approval to edit the shared component.

No dates are assigned.

## Dependency order

1. Package A — Service payment security. Already written, not released. Finish its release gates before any later package is deployed.
2. Package B — Journal integrity. Historical reversals wait for B's investigation and a separate data approval.
3. Package C — Credit notes and receivables. Can be designed while B is reviewed. Do not change `recalculate_invoice_status` until the dependency list in INV-001 is tested. Do not deploy C's reports on top of uncorrected duplicate journals without saying which journals are still live.
4. Package D — Financial statements. Depends on B for any statement that reads journals, and on the shared-report review.
5. Package E — Tax and payroll. Independent of C's labels. Shares the ledger with B, so do not post new payroll rules into a ledger that B is about to constrain.
6. Package F — Banking and materials. After the shared bank-reconciliation review. Materials posting should follow B's idempotency rule.
7. Package G — Remaining workflows. Quote conversion can be designed in parallel. Items inside QA-001 stay blocked until the QA file is produced.

A later package is not started as coding until the owner accepts this plan and names that package.

## Package A — Service payment security

Tracked work, already in the working tree. Do not rewrite it as part of this document.

- Invoice public-token authorization: SEC-001 through SEC-005.
- Paystack charge, verify, and OTP: SEC-004, PAY-001.
- Tenant MoMo initiation and status: SEC-002, SEC-003.
- Service Hubtel invoice authorization: SEC-005. The baseline already required the token. The helper move is the only change.
- Pending versus successful payment handling: PAY-001.
- Payment-reference uniqueness: PAY-002. Migration 588 is applied on staging `adonhhtooawkeemdqqeo` and is not applied on production.
- Regression coverage: 11 October 2026, rerun after the blocker edits, 15 suites, 78 tests, all passed. That run includes Paystack charge, verify, OTP, binding, tenant MoMo, Hubtel token delegation, and the MTN callback hint tests.
- Build and lint: the ESLint accounting pattern now loads, and targeted lint reported 0 errors and 3 warnings. `npm run lint` still does not run ESLint. The control-tower page type is corrected. The webpack build still fails on `app/api/accounting/afs/[run_id]/finalize/route.ts`. INF-001 and INF-002 stay open. See `PACKAGE_A_ACCEPTANCE_REPORT.md`.
- Paystack success is recorded only when the payload is bound to the authorized invoice. Public invoice tokens do not expire. Expiry was not added.

Out of scope: `POST /api/payments/momo`, `POST /api/payments/hubtel` (SEC-006), Retail tests, journal uniqueness, credit-note labels.

| Item | Position |
|---|---|
| Dependencies | None on B–G. PAY-002 must be applied on a database before success settlement is enabled there. Staging has the index. Production does not. |
| Risk | High. The routes take money and insert `payments`, which posts the ledger. |
| Scope boundaries | The files already modified or added on this branch for Service invoice pay. No new behavior in this documentation phase. |
| Acceptance criteria | SEC-001 through SEC-005 and PAY-001 meet the criteria in the register. PAY-002's index is present in the target database before that database accepts the new settlement code. |
| Required tests | The Service payment suites were re-run: 15 suites, 78 tests. A second staging insert of the same `FNZ-` reference failed with `23505`. The twelve HTTP staging scenarios were not run. |
| Database migration | 588 only. Applied on staging after a zero-row check. Not applied on production. |
| Historical data correction | None. The 11 October check found 0 duplicate `FNZ-` groups excluding `FNZ-SUB-`. |
| Rollback | Redeploy the previous production deployment. If 588 was applied, drop `payments_reference_fnz_invoice_unique` only. Do not drop MTN or Hubtel indexes. |
| Release gate | All twelve gates in `RELEASE_GATES.md`. A green test run is not enough. The production build and the twelve staging scenarios are still open. Owner approval is required before commit, production apply, or deploy. |

## Package B — Journal integrity

- LED-001 duplicate live journals.
- LED-002 posting idempotency, including the unique-reference design.
- LED-003 is closed as not reproduced. Reversals stay legal.
- LED-004 one orphan GHS 10 journal, reviewed with the same historical process.
- Accounting transaction atomicity for the posting functions that currently check, then insert.
- Reversal safeguards: a reversal must still be insertable.

| Item | Position |
|---|---|
| Dependencies | Package A released or explicitly deferred by the owner. The unique-index design is blocked on an architectural review because `journal_entries` is shared and Retail posts `reference_type = sale`. |
| Risk | High. A bad constraint can stop Retail sales or block legitimate reversals. A bad reversal changes closed books. |
| Scope boundaries | Design and, after review, Service posting functions. No Retail route. No automatic reversal. |
| Acceptance criteria | A repeated source post returns the first live journal. A reversal still posts. Retail sale posting still posts. Each LED-001 group and LED-004 has a written keep-or-reverse decision. |
| Required tests | Idempotent invoice, payment, credit note, bill, and expense post. Reversal insert. A fixture that mimics a Retail sale insert against the proposed index. |
| Database migration | None until the review approves a predicate. Do not add the index in Package A. |
| Historical data correction | Separate authorization. The three extra live journals and the GHS 10 orphan are the only candidates identified. Expense reversal pairs are not candidates. |
| Rollback | New constraint dropped by name. Historical reversals are themselves journals and are not undone by a code rollback. |
| Release gate | Gates 1–12, plus a signed correction plan before any production journal is reversed. |

## Package C — Credit notes and receivables

- INV-001 cash collected versus credit-note settlement, and the Paid in full label. This is the production full-credit case. It is not QA items 9 or 10.
- INV-002 sales collection reporting.
- INV-003 credit-note page figures on a partly paid invoice. Reported only. QA item 9.
- INV-004 credit-note form allows a credit above the unpaid amount. Reported only. QA item 10.
- UI-010 issue credit note offered on an unnumbered draft. Reported only. QA item 25.
- Outstanding receivables stay total minus payments minus applied credits.
- Overdue behavior stays: due date before today, remaining above zero, drafts and cancelled invoices excluded. Migration 587 is already applied and is not reapplied.
- Credit-note validation stays inside existing capacity checks unless a new defect is reproduced.

| Item | Position |
|---|---|
| Dependencies | INV-001's downstream list: overdue, receivables, and payment guards. Package B's live duplicate credit-note journals should be identified before a report change is treated as the full cash figure. The display hotfix on `fix/service-credited-invoice-label` is a different worktree and is not this package's implementation. |
| Risk | High if `recalculate_invoice_status` changes. Medium if the change is presentation and report math only. |
| Scope boundaries | Service invoice labels and Service sales summary. No status-function change until that dependency list is tested. No Retail invoice or POS status. |
| Acceptance criteria | A fully credited invoice is not shown as cash received. `paidRevenue` equals recorded payments. Outstanding and overdue still exclude drafts, cancelled invoices, and zero remaining. QA items 9, 10, and 25 are reproduced or explicitly recorded as not reproduced before those three entries are implemented. |
| Required tests | Full credit, partial credit, partial cash, mixed cash and credit, missing amount load, overdue exclusion. |
| Database migration | None for a presentation-only change. Any status-function change is a shared migration and stops for review. |
| Historical data correction | None for stored `paid` rows until a status design is approved. Do not bulk-update the 13 invoices. |
| Rollback | Redeploy the previous application build. Stored statuses are unchanged in the presentation-only path, so no data rollback is required. |
| Release gate | Gates 1–12. Financial reconciliation compares the new cash figure to `payments` for one staging tenant before production. |

## Package D — Financial statements

- FIN-001 trial-balance date filtering.
- FIN-002 empty versus balanced.
- FIN-003 snapshot staleness.
- FIN-004 balance sheet and changes in equity.
- FIN-005 cash flow versus cash and bank.
- FIN-006 stays not reproduced. The QA all-zero screen is not cleared by the non-zero snapshot that was read. No snapshot rebuild to chase it.
- FIN-007 period 2026-01 listed on some statements and not others. Reported only. QA item 26.
- UI-003 dashboard latest period showed July while October was active. Reported only. QA item 18.
- Accounting periods stay as they are until a period-close defect is reproduced. Period close does not journal profit into retained earnings; that is an input to FIN-004, not a separate approved change.

| Item | Position |
|---|---|
| Dependencies | Shared report resolver, snapshot RPCs, and equity functions. Retail report callers must be listed before an edit. Package B if journal duplicates would otherwise be reported as truth. |
| Risk | High. These functions are the financial statements. `get_trial_balance_from_snapshot` writes when it regenerates. |
| Scope boundaries | Read-path correctness and staleness signaling. No mass regenerate in the deploy. |
| Acceptance criteria | The register criteria for FIN-001 through FIN-005. A stale snapshot is visible as stale. FIN-007 and UI-003 stay reported until reproduced. |
| Required tests | Cross-month range, empty result, line-level invalidation, equity equals balance-sheet equity, cash-flow closing cash equals accounts 1000–1099. |
| Database migration | Possible trigger change for line-level staleness. Shared. Not authorized until the review. |
| Historical data correction | Do not regenerate the 32 stale snapshots as part of the code deploy. A later, separate job can rebuild them after the read path is correct. |
| Rollback | Redeploy the application. A trigger change is reverted by a forward migration that restores the previous trigger body. Rebuilt snapshots are not automatically restored. |
| Release gate | Gates 1–12. Staging acceptance uses a copy of journals, not production. |

## Package E — Tax and payroll

- TAX-001 VAT, NHIL, and GETFund settlements versus input tax. This does not by itself explain QA item 4.
- TAX-002 stays needs reproduction. No COVID change. TAX-007 is the separate report that no COVID option exists.
- TAX-003 reported net 6.25 versus components that subtract to 8.33. QA item 4. Reported only.
- TAX-004 reported output 583.34 versus an expected figure of about 250. QA item 4. Reported only. The expected figure is approximate.
- TAX-005 inclusive 2,000 shown as base 1,666.66. QA item 28. Reported only. Shared tax rounding. Not authorized.
- TAX-006, TAX-008, TAX-009, and PRL-007 are product gaps from the incomplete section. No build until the owner decides.
- TAX-010 withholding register empty. Reported only. Not the same as FIN-005.
- PRL-001 draft payroll cannot post through a direct function call.
- PRL-002 and PRL-003 stay not reproduced. The QA figures are now recorded and were not the rows previously checked.
- PRL-004 and PRL-005 stay needs reproduction. QA item 12 names missing TIN/GRA position. QA item 6 names 4,100 + 596.41. No profit-and-loss adjustment.
- PRL-006 employer SSNIT not shown on the employee line. Reported only.
- Withholding-tax reporting is in scope only as FIN-005's account 2155, TAX-010's empty register, and the existing bill and invoice withholding accounts. No new withholding report is invented.

| Item | Position |
|---|---|
| Dependencies | Shared tax extract. Service payroll functions. Package B's journal constraint, so a payroll post still has exactly one live journal. |
| Risk | High for tax filings and payroll journals. |
| Scope boundaries | Ghana VAT extract and Service payroll posting guards for TAX-001 and PRL-001. Reported QA tax and payroll items stay out of that slice until reproduced. No change to statutory rates. No change to stored pay runs. Product gaps wait for an owner decision. |
| Acceptance criteria | TAX-001 and PRL-001 criteria in the register. |
| Required tests | VAT payment is not input tax. Supplier input tax still is. Draft payroll RPC raises and leaves no journal. Approve posts once. |
| Database migration | Function replacements for the tax extract and `post_payroll_to_ledger`. Each is reviewed as shared SQL even if the current callers are Service. |
| Historical data correction | None until a filed return or a draft journal is identified. The 10 October count found no draft run with a journal. |
| Rollback | Forward migration restoring the previous function bodies. Posted payroll journals are not deleted by that rollback. |
| Release gate | Gates 1–12. A tax change needs a worked example against one synthetic period before staging acceptance. |

## Package F — Banking and materials

- BNK-001 account eligibility, debit and credit sign, opening balance. QA item 7 amounts (-5,200 and +2,027.50) are recorded and were not remeasured.
- BNK-002 reconciliation page empty. Reported only. It may be a different screen from BNK-001. Not authorized.
- MAT-001 consumed usage posting, including insert-as-consumed.
- MAT-002 stays not reproduced. The quantity 1,815 is not the QA buy of 800 and use of 240.
- MAT-003 QA Cement purchase and usage posted nothing to inventory, cost, cash, or payables. Reported only. No stock adjustment.
- Cash and bank balances are the acceptance target for BNK-001 and the tie-out for FIN-005. Package F does not redefine cash.

| Item | Position |
|---|---|
| Dependencies | Architectural review of the shared reconciliation screen. Confirm the material trigger is not on a Retail stock table. Package B idempotency for the usage journal. |
| Risk | Medium for materials. High if the shared bank screen is edited without the review. |
| Scope boundaries | Service material usage trigger. Bank screen only after the review, or a Service-only wrapper if the review requires one. |
| Acceptance criteria | BNK-001 and MAT-001 criteria in the register. MAT-003 and BNK-002 are reproduced before any data or screen change for those two entries. |
| Required tests | Asset sign, account filter, opening balance, insert-as-consumed posts once, purchase still debits 1450. |
| Database migration | Possible trigger replacement for usage. Not authorized until the Retail-stock check is written down. |
| Historical data correction | None until usage rows that skipped posting are counted in a read-only query. That count has not been done. |
| Rollback | Restore the previous trigger. Do not delete usage journals in the rollback. |
| Release gate | Gates 1–12. The shared-screen review is an entry condition, not a substitute for the gates. |

## Package G — Remaining Service workflows

- DOC-001 quote conversion. QA item 8. The code race is confirmed. The two QA invoices were not identified.
- DOC-002 material quote requires supply mode and offers no control. QA item 13. Reported only.
- DOC-003 failed quote email marked Sent. QA item 14. Reported only.
- DOC-004 no general manual journal. QA item 15. Product decision. Shared ledger. Not authorized.
- QA-001 is an index only. It is not a work item.
- UI-001, UI-002, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009, and UI-011 are reported display items. UI-003 is in Package D. UI-010 is in Package C.
- Invoice and supplier-bill workflow defects now include UI-004 and UI-005. LED-002 remains the bill posting race. A bill payment correction needs its own reproduced entry.
- Reporting UI for statements stays in Packages C and D. Package G does not restyle those reports.

| Item | Position |
|---|---|
| Dependencies | DOC-001 can proceed once the owner names Package G and a check shows Retail does not call the convert route. DOC-002, DOC-003, and the UI items stay reported until reproduced. DOC-004 waits for a product decision and a shared-journal review. |
| Risk | Medium for duplicate invoices. Low for display items until a wrong posted amount is shown. DOC-004 would be high if a manual journal were added without review. |
| Scope boundaries | `POST /api/estimates/convert/[id]` for DOC-001. Reported UI and quote-save items only after reproduction. No manual journal in this package until the owner specifies it. |
| Acceptance criteria | DOC-001 criteria. Each reported G item is reproduced or left REPORTED. QA-001 is not implemented. |
| Required tests | Two overlapping converts, one invoice. Further tests are named on each reported ID. |
| Database migration | A uniqueness rule on the estimate conversion. Review before writing it. |
| Historical data correction | None until duplicate converted pairs are counted. They have not been counted. |
| Rollback | Restore the previous route. A uniqueness constraint is dropped by name. Invoices already created are not deleted by the rollback. |
| Release gate | Gates 1–12. Reported items cannot pass gate 1 until they are reproduced. DOC-004 cannot pass gate 2 until the shared-journal review is done. |
