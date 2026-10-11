# Finza Service — Programme status

Status date: 11 October 2026. Counts are the entries in `MASTER_DEFECT_REGISTER.md`. No percentage is used.

The QA reconciliation on this date added reported items from the owner-supplied 10 October 2026 report. It did not change any implementation, and it did not move any entry to VERIFIED, RELEASED, or CLOSED.

Package A remains the uncommitted Service payment work that already existed on this branch.

## Totals

63 register entries. The previous count was 34. Twenty-nine IDs were added. QA-001 remains, now as an index.

| Severity | Entries | IDs |
|---|---|---|
| P0 | 8 | SEC-001, SEC-002, SEC-003, SEC-004, PAY-001, LED-001, LED-002, INV-001 |
| P1 | 8 | INV-002, FIN-001, FIN-002, FIN-003, FIN-004, TAX-001, BNK-001, DOC-001 |
| P2 | 8 | SEC-005, SEC-006, LED-004, PAY-002, FIN-005, PRL-001, MAT-001, INF-002 |
| P3 | 1 | INF-001 |
| Not rated | 38 | LED-003, FIN-006, FIN-007, INV-003, INV-004, TAX-002, TAX-003, TAX-004, TAX-005, TAX-006, TAX-007, TAX-008, TAX-009, TAX-010, PRL-002, PRL-003, PRL-004, PRL-005, PRL-006, PRL-007, MAT-002, MAT-003, BNK-002, DOC-002, DOC-003, DOC-004, QA-001, UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009, UI-010, UI-011 |

## Confirmed and unverified

| Status | Count | IDs |
|---|---|---|
| CONFIRMED | 18 | SEC-006, LED-001, LED-002, LED-004, INV-001, INV-002, FIN-001, FIN-002, FIN-003, FIN-004, FIN-005, TAX-001, PRL-001, BNK-001, MAT-001, DOC-001, INF-001, INF-002 |
| IMPLEMENTED UNVERIFIED | 6 | SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, PAY-001 |
| IN PROGRESS | 1 | PAY-002 |
| NEEDS REPRODUCTION | 3 | TAX-002, PRL-004, PRL-005 |
| NOT REPRODUCED | 5 | LED-003, FIN-006, PRL-002, PRL-003, MAT-002 |
| REPORTED | 30 | QA-001 plus the 29 IDs added in the reconciliation: INV-003, INV-004, FIN-007, TAX-003, TAX-004, TAX-005, TAX-006, TAX-007, TAX-008, TAX-009, TAX-010, PRL-006, PRL-007, BNK-002, MAT-003, DOC-002, DOC-003, DOC-004, UI-001, UI-002, UI-003, UI-004, UI-005, UI-006, UI-007, UI-008, UI-009, UI-010, UI-011 |
| BLOCKED | 0 | QA-001 is no longer blocked. The source text is preserved. The entry is an index, not a fix. |
| VERIFIED, RELEASED, or CLOSED | 0 | — |

25 entries are confirmed findings or a fix for a confirmed finding. That set did not change. 30 entries are reported from the QA text and are not independently verified. 3 still need reproduction. 5 were checked and not reproduced, and those checks were not shown to be the QA login `support@finza.africa`, so they do not clear the QA examples.

`IMPLEMENTED UNVERIFIED` is not verified and not released. The local Service payment tests passed on 11 October 2026. That run does not move those entries to VERIFIED.

## Completed implementations

None are released.

Uncommitted on this branch, not committed and not deployed:

- SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, PAY-001
- PAY-002 file `supabase/migrations/588_paystack_invoice_payment_reference_unique.sql`, applied on staging only, not on production

A credit-note label change exists on another worktree and is not counted as an implementation of INV-001.

## Pending verification

- Re-run Package A tests on a release commit. A later 11 October 2026 run again passed 15 suites and 78 tests on this working tree. That is not a release.
- Hubtel initiate, status, return, and cancel routes were not executed. Only `validateInvoicePublicToken` was unit-tested.
- Migration 588 is applied on staging `adonhhtooawkeemdqqeo` only. It is not applied on production. A real pair of staging inserts for the same `FNZ-` reference left one payment and one payment journal. The rejected insert returned `23505` from the database. That is not an application verify request.
- INF-002: the accounting override now uses an object pattern, and targeted ESLint completed with 0 errors and 3 warnings in `app/pay/[invoiceId]/page.tsx`. `npm run lint` still does not invoke ESLint, because Next.js 16.1.7 treats `lint` as a directory. The entry stays CONFIRMED.
- INF-001: the control-tower page now awaits `params`. `npx next build --webpack` then failed on `app/api/accounting/afs/[run_id]/finalize/route.ts`. Further route edits were not made. The entry stays CONFIRMED.
- Staging database isolation was checked and used for migration 588 and the insert test. Staging HTTP acceptance was not run. This worktree has no staging app URL and no Paystack secret.
- Invariants 1–5 and 7–9 have missing tests listed in `ACCOUNTING_INVARIANTS.md`.
- Every REPORTED QA entry still needs a reproduction on the QA account, or a written note that the example cannot be found there. See `QA_SOURCE_RECONCILIATION.md`.

## Release blockers

- Gate 10: owner approval has not been given for any package.
- Package A is uncommitted.
- PAY-002 is applied on staging only. Production can still double-insert until 588 is applied there, and that apply is not approved.
- INF-001: the local production build still fails, now on the accounting AFS finalize route. INF-002: targeted lint has warnings, and `npm run lint` still does not run ESLint.
- Gate 8: the twelve staging application scenarios have not been run. The QA business is on the production database and is not an acceptance tenant.
- SEC-006, BNK-001, LED-002, FIN-001, FIN-004, FIN-005, and TAX-001 touch shared or possibly shared code. Those edits are not authorized. The same limit applies to reported items that may share tax, period, reconciliation, or journal screens: TAX-005, TAX-006, FIN-007, BNK-002, DOC-004, UI-003, UI-006, and UI-011.
- LED-001 and LED-004 need a separate correction plan before any production journal is reversed.
- Reported QA items cannot pass gate 1 until they are reproduced. They do not block a decision on Package A.

## Outstanding migrations

| Migration | State |
|---|---|
| 587 operational overdue | Already applied in production. Do not reapply. |
| 588 Paystack invoice reference unique | Applied on staging `adonhhtooawkeemdqqeo` on 11 October 2026. Not applied on production. Production apply is not authorized by this document. |
| Journal unique key for LED-002 | Not designed and not authorized. |
| Any snapshot rebuild for FIN-003 | Not authorized. |

## Package status

| Package | Status |
|---|---|
| A Service payment security | Implemented in the working tree, unverified, uncommitted, not deployed. Jest passed again (15 suites, 78 tests). ESLint config loads. Control-tower params typing is corrected. The production build still fails on the next accounting route. Migration 588 is on staging only, with a real concurrent insert observed. The twelve HTTP scenarios were not run. Verdict: NOT READY. |
| B Journal integrity | Not started. Shared-ledger review required before a constraint. |
| C Credit notes and receivables | Not started. Now also tracks reported INV-003, INV-004, and UI-010. |
| D Financial statements | Not started. Now also tracks reported FIN-007 and UI-003. Shared-report review required. |
| E Tax and payroll | Not started. Now also tracks the reported VAT arithmetic, rounding, and payroll display items. Product gaps wait for a decision. |
| F Banking and materials | Not started. Now also tracks reported MAT-003 and BNK-002. Shared bank screen is not authorized. |
| G Remaining workflows | DOC-001 not started. Reported quote, email, and display items are listed. QA-001 is an index. DOC-004 is a product decision. |

## Next engineering action

Do not start Package A implementation work, and do not start Package B.

The next action is an owner decision. The blocker pass corrected the ESLint accounting pattern and the control-tower `params` type, applied 588 on staging, and stopped when the production build failed on the next route. Do not continue that build sweep. Do not apply 588 to production. Do not deploy. The new QA entries stay reported until the owner asks for a reproduction pass.

After Package A is accepted or explicitly deferred, the next code package is B, and only for the design of journal idempotency. Historical reversals stay behind a separate correction approval.

## Findings that are not in the QA report

These register entries are from the production code audit, the payment-security work, or read-only queries. They are not items in the 10 October QA text:

SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, LED-001, LED-002, LED-003, LED-004, PAY-001, PAY-002, INV-001, INV-002, FIN-001, FIN-002, FIN-003, FIN-005, TAX-001, TAX-002, PRL-001, MAT-001, INF-001, INF-002.

FIN-001, FIN-002, TAX-001, PRL-001, and MAT-001 are code findings that partly relate to a QA item. The reconciliation says which QA item. They were not copied from the report.

INV-001 is the production full-credit label. QA items 9 and 10 are INV-003 and INV-004.

## Workspace

- Repository worktree: `C:\projects\finza-web\finza-payment-auth`
- Branch: `fix/prod-payment-authorization`
- HEAD: `ee5cdb2256b59baccf85a598fbc53e083153e53b`
- Production deployment at the last check: `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH`, READY, `app.finza.africa`. This reconciliation did not deploy.
- Other worktrees were not modified.
- Retail `POST /api/payments/momo` was not edited.
