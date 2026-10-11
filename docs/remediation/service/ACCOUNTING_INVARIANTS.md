# Finza Service — Accounting invariants

Status date: 11 October 2026. These are the properties automated tests must protect. A passing test does not close a defect in the master register.

Coverage below is what exists on `fix/prod-payment-authorization` at `ee5cdb2256b59baccf85a598fbc53e083153e53b`, plus the uncommitted Package A tests. The credit-label worktree is not this branch, so its tests are not counted as coverage here.

## 1. Journal debits equal credits

Every posted journal has equal debits and credits, and a trial balance that claims to be balanced has rows behind that claim.

| Existing coverage | Missing tests |
|---|---|
| `generate_trial_balance` computes both sides. Balance-sheet unit tests exist (`getBalanceSheetReport.test.ts`, `cumulativeBalanceSheet.test.ts`). They were not re-run for this programme. | No test asserts that a journal insert with unequal lines is rejected. FIN-002 is uncovered: an empty snapshot must not be reported as balanced. |

Related defects: FIN-002, LED-001.

## 2. Every posted financial transaction has valid source linkage

A payment journal points at a payment. An invoice journal points at an invoice. A credit-note journal points at a credit note. A payroll journal points at a payroll run.

| Existing coverage | Missing tests |
|---|---|
| `assertPaymentJournalPosted` checks that a payment insert has a journal, and soft-deletes the payment if the journal is missing. Package A calls it only after a successful settlement. | No test that an invoice, credit note, bill, or payroll journal fails when the source row is absent. LED-004 shows one historical journal with no invoice. No automated detector for that shape. |

Related defects: LED-001, LED-004, PAY-001.

## 3. Repeated requests do not create unintended duplicate postings

A second request for the same source returns the first live journal. A reversal is not a duplicate.

| Existing coverage | Missing tests |
|---|---|
| Package A: `paystackInvoiceSettlement.test.ts` returns the existing payment for the same reference and does not insert again. That test is sequential, not concurrent. MTN and Hubtel reference indexes exist on the baseline. `lib/payroll/__tests__/createPayrollPaymentIdempotencyKey.test.ts` covers a payment idempotency key, not the ledger function. | No test for a second invoice, credit-note, bill, or expense post. No test that two overlapping Paystack success requests insert once. Migration 588 is the intended database guard and is not applied. No test that a reversal is still allowed. DOC-001 has no concurrent-convert test. |

Related defects: LED-002, LED-003, PAY-002, DOC-001, PRL-001.

## 4. Financial statements reconcile over consistent periods

For one business and one as-of date, the balance sheet balances, equity closing equals the balance sheet equity section, and cash-flow closing cash equals cash and bank on that balance sheet. A custom date range uses those dates.

| Existing coverage | Missing tests |
|---|---|
| Balance-sheet unit tests and `balance_sheet_rpc_oneshot_auth_577.test.sql` exist. They were not re-run here. Nothing in the test file names found on this branch covers trial-balance date ranges, equity, or cash flow. | FIN-001 range test. FIN-004 equity-versus-balance-sheet fixture with profit outside the selected month. FIN-005 fixture that moves account 2155. FIN-003 test that a journal line marks the snapshot stale. |

Related defects: FIN-001, FIN-003, FIN-004, FIN-005.

## 5. Credit notes do not count as cash received

Cash collected is the sum of payments. Applied credits reduce the amount still to collect. They are not cash. A fully credited invoice is not labeled as paid in cash.

| Existing coverage | Missing tests |
|---|---|
| `lib/creditNotes/__tests__/invoiceCreditCapacity.test.ts` and `app/api/credit-notes/__tests__/create.test.ts` exist. They cover credit capacity and creation, not the Paid label and not `paidRevenue`. | INV-001 label cases. INV-002 sales-summary cases: full credit adds nothing to cash; a partial payment adds only the cash. The other worktree's label tests are not on this branch. |

Related defects: INV-001, INV-002.

## 6. Pending payment attempts do not create settled accounting payments

`pay_offline` and `send_otp` do not insert `payments` and do not post a payment journal. Only a provider success does. A second success for the same reference does not post again.

| Existing coverage | Missing tests |
|---|---|
| Package A charge test: pending approval does not insert. Settlement test: an existing reference does not insert again. Both passed on 11 October 2026 in the 38-test run. | Verify and OTP do not have their own passing suite for the non-success path. No database test that the payments trigger is silent when no row is inserted. No concurrent success test (see invariant 3). |

Related defects: PAY-001, PAY-002, SEC-004.

## 7. Draft payroll cannot create unauthorized ledger postings

A draft run has no journal. Approval posts once. A direct call to `post_payroll_to_ledger` on a draft raises and leaves no journal.

| Existing coverage | Missing tests |
|---|---|
| `lib/payroll/__tests__/ghanaApprovalGuards.test.ts`, `mapApprovePayrollAtomicError.test.ts`, and `graFilingSnapshots.test.ts` exist. They were not executed for this programme. Live data on 10 October 2026 had 0 draft runs with a journal. | No test that the database function itself rejects a draft. The application guard is not the invariant, because the function is executable by `authenticated`. |

Related defects: PRL-001, PRL-004, PRL-005.

## 8. VAT settlements are distinguished from eligible input tax

A debit that pays VAT, NHIL, or GETFund payable is a settlement of the liability. It is not input tax. Input tax comes from purchase-side tax.

| Existing coverage | Missing tests |
|---|---|
| eVAT draft mapping tests exist under `lib/gra/evat`. They map invoice payloads. They do not assert the ledger return formula. | A fixture period with output VAT, a supplier input, and a payment of the VAT liability. Net payable falls by the input only. TAX-002 (COVID) is not an invariant until a statutory result is written down. |

Related defects: TAX-001.

## 9. Bank reconciliation follows the correct accounting sign conventions

Only cash and bank accounts are offered. For an asset, a debit increases the book balance and a credit decreases it. The period starts from the opening balance.

| Existing coverage | Missing tests |
|---|---|
| No test filename on this branch matches bank reconciliation. | All three assertions in BNK-001. The screen is shared, so the test must say which workspace it covers before anyone edits the screen. |

Related defects: BNK-001.

## 10. Tenant financial data remains isolated

A public invoice payment is authorized only by that invoice's `public_token`. A client-supplied business id is ignored. A receipt token is not an invoice token. One tenant's token does not settle another tenant's invoice.

| Existing coverage | Missing tests |
|---|---|
| Package A: `invoicePayCapability.test.ts`, Paystack charge tests including a receipt token, and tenant MoMo initiate and status tests. Passed on 11 October 2026. Service Hubtel invoice routes already matched the token on the baseline. | Hubtel initiate with a foreign token, after the helper move, was not in the 38 passing tests. Verify and OTP foreign-token cases were not in that run. SEC-006 and Retail `POST /api/payments/momo` are outside this invariant's authorized fixes. |

Related defects: SEC-001, SEC-002, SEC-003, SEC-004, SEC-005.
