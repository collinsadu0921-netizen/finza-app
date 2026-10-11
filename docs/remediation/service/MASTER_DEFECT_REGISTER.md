# Finza Service — Master defect register

Status date: 11 October 2026. Documentation only. No application code was changed for this register.

Reconciliation addendum, same date: the owner supplied the 10 October 2026 QA text in the reconciliation request. A copy is preserved at `docs/remediation/service/sources/finza-demo-qa-report.md`. No pre-existing `finza-demo-qa-report.md` was found on disk. Existing tracking IDs are unchanged. New IDs start after the previous highest ID in each category. No entry was moved to VERIFIED, RELEASED, or CLOSED.

## Sources and limits

| Source | What was available |
|---|---|
| Production deployment | `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH`, READY, aliased to `app.finza.africa`. Re-checked 11 October 2026. Source is CLI, so Vercel stores no git SHA. |
| Production code baseline | `ee5cdb2256b59baccf85a598fbc53e083153e53b`. This is the commit uploaded for that deployment and the HEAD of `fix/prod-payment-authorization`. |
| Production accounting audit | 10 October 2026, read-only code on that commit and read-only queries on Finza Pro. |
| Payment security verification | 10–11 October 2026, on the uncommitted Service package in this worktree. |
| `finza-demo-qa-report.md` | Not found as a pre-existing file. The owner supplied the report text on 11 October 2026. That text is preserved unchanged under `sources/`. It was not reconstructed from earlier summaries. |
| QA account named in that text | Finza Demo, `support@finza.africa`, currency GHS. Prior read-only checks in this register were not identified as that login. Those checks do not clear a QA example. |

Retail defects are not in this register. `POST /api/payments/momo` has no diff against the production commit and is not a Service package.

A display-only credit-note label change exists as uncommitted work on another worktree (`fix/service-credited-invoice-label`). It is not part of this branch and is not marked implemented here.

## Status vocabulary

`REPORTED`, `CONFIRMED`, `NEEDS REPRODUCTION`, `IN PROGRESS`, `IMPLEMENTED UNVERIFIED`, `VERIFIED`, `RELEASED`, `CLOSED`, `BLOCKED`, `NOT REPRODUCED`.

`IMPLEMENTED UNVERIFIED` means the Service working tree contains a change and a local test run passed. It is not committed, not released, and not closed.

## SEC — Security and authorization

### SEC-001

- Tracking ID: SEC-001
- Original QA reference: none. Found in the production accounting audit.
- Module: Service Paystack invoice charge
- Description: `POST /api/payments/paystack/charge` on the production baseline treats the invoice UUID as authority and can insert a payment with the service role.
- Severity: P0
- Evidence and source: Production route on `ee5cdb2`, read 10 October 2026. Uncommitted package adds `assertInvoicePayCapability`.
- Reproduction status: Confirmed on the baseline. Local charge tests passed on the branch (38-test Service payment run, 11 October 2026).
- Root cause: No session and no `invoices.public_token` match before the service-role insert.
- Potential tenant impact: Any caller who knows an invoice id.
- Financial or security impact: Can start a charge and insert a `payments` row for another tenant's invoice.
- Affected code paths: `app/api/payments/paystack/charge/route.ts`
- Dependencies: SEC-004, PAY-001, `lib/payments/invoicePayCapability.ts`
- Proposed remediation: Require the invoice id and that invoice's `public_token`. Ignore a client business id. Package A. Do not change Retail.
- Required tests: Missing token, foreign token, receipt token, client business id ignored.
- Acceptance criteria: A token that is not `invoices.public_token` for that id does not insert a payment or call Paystack.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### SEC-002

- Tracking ID: SEC-002
- Original QA reference: none
- Module: Tenant MoMo invoice initiation
- Description: `POST /api/payments/momo/tenant/invoice/initiate` on the baseline starts an MTN collection from an invoice id alone.
- Severity: P0
- Evidence and source: `initiateTenantMtnInvoicePayment` on `ee5cdb2`. Branch requires `public_token` before credentials load.
- Reproduction status: Confirmed on the baseline. Covered by the 11 October Service payment test run.
- Root cause: The invoice UUID was treated as the capability.
- Potential tenant impact: Any caller who knows an invoice id.
- Financial or security impact: Can start a request-to-pay with that tenant's MTN credentials.
- Affected code paths: `app/api/payments/momo/tenant/invoice/initiate/route.ts`, `lib/tenantPayments/mtnInvoiceDirectService.ts`
- Dependencies: SEC-001 capability helper
- Proposed remediation: Package A token check. No Retail change.
- Required tests: Missing token, mismatched token, repeated initiate reuses an open session.
- Acceptance criteria: MTN credentials are not loaded when the token does not match the invoice.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### SEC-003

- Tracking ID: SEC-003
- Original QA reference: none
- Module: Service MoMo status and settlement
- Description: Tenant MoMo status, and the Service compatibility `GET /api/payments/momo/status`, could verify and settle from an invoice id without the invoice public token.
- Severity: P0
- Evidence and source: Both routes on `ee5cdb2`. Branch calls `assertInvoicePayCapability` before `verifyTenantMtnInvoiceByReference`.
- Reproduction status: Confirmed on the baseline. Status-route tests passed on 11 October 2026.
- Root cause: Invoice id was treated as public authority for a route that can insert `payments`.
- Potential tenant impact: Any caller who knows an invoice id and a provider reference.
- Financial or security impact: Settlement can post a payment.
- Affected code paths: `app/api/payments/momo/tenant/invoice/status/route.ts`, `app/api/payments/momo/status/route.ts`
- Dependencies: SEC-002. `GET /api/payments/momo/status` is the Service compatibility poll, not `POST /api/payments/momo`.
- Proposed remediation: Package A. Do not edit the Retail POST route.
- Required tests: Missing token does not settle. Foreign token does not settle. Matching token verifies that invoice only.
- Acceptance criteria: Settlement does not run unless the token matches the invoice on the session.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### SEC-004

- Tracking ID: SEC-004
- Original QA reference: none
- Module: Paystack verify and OTP
- Description: Invoice Paystack verify and OTP submission on the baseline can be called with a reference and no invoice token. Platform references that start with `FNZ-SUB-` are a separate subscription path.
- Severity: P0
- Evidence and source: `app/api/payments/paystack/verify/route.ts` and `submit-otp/route.ts` on `ee5cdb2`.
- Reproduction status: Confirmed on the baseline. On 11 October 2026 the branch tests reject a missing token, a foreign token, a charge bound to another invoice, and a platform subscription reference still verifies without an invoice token. A live staging call was not made.
- Root cause: Public polling trusted the Paystack reference, and a successful Paystack payload was not checked against the authorized invoice.
- Potential tenant impact: Anyone who knows a reference and any invoice public token.
- Financial or security impact: Verify can observe a charge. Success verify and OTP insert the settling payment, so the token check and the Paystack invoice binding are both mandatory.
- Affected code paths: the two Paystack routes above, `lib/payments/paystackInvoiceBinding.ts`
- Dependencies: SEC-001, PAY-001, PAY-002
- Proposed remediation: Package A. Keep `FNZ-SUB-` on the platform path. Do not record a payment unless Paystack metadata names the authorized invoice. Do not add token expiry in this package.
- Required tests: Foreign token does not call Paystack for an invoice reference. A success bound to another invoice does not insert. Subscription references still verify without an invoice token.
- Acceptance criteria: An invoice reference cannot be verified or completed with OTP unless the invoice token matches and Paystack's payload names that invoice.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### SEC-005

- Tracking ID: SEC-005
- Original QA reference: none
- Module: Service Hubtel invoice checkout
- Description: Service Hubtel invoice initiate, status, return, and cancel already required the invoice public token on the production baseline. Package A points that check at the shared capability helper. The query is the same match of invoice id and `invoices.public_token`.
- Severity: P2
- Evidence and source: `validateInvoicePublicToken` on `ee5cdb2`, now delegated to `assertInvoicePayCapability`.
- Reproduction status: Baseline control confirmed by reading the route. `validateInvoicePublicToken` delegation is covered by `hubtelInvoiceToken.test.ts` in the 11 October 2026 run. The Hubtel initiate route itself was not executed.
- Root cause: Not an open authorization hole on the baseline. The residual risk is drift if a future edit bypasses the helper.
- Potential tenant impact: None identified beyond the existing public-token model.
- Financial or security impact: Low, provided every Service Hubtel entry keeps using the helper.
- Affected code paths: `lib/tenantPayments/hubtelInvoiceDirectService.ts` and the tenant invoice Hubtel routes
- Dependencies: SEC-001
- Proposed remediation: Keep the helper as the only Service invoice capability check. Do not edit `POST /api/payments/hubtel` in Package A.
- Required tests: Hubtel initiate rejects a foreign token. Not executed in the 11 October run.
- Acceptance criteria: A Service Hubtel invoice call without a matching token does not create a checkout.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### SEC-006

- Tracking ID: SEC-006
- Original QA reference: none
- Module: Legacy Hubtel settings route
- Description: `POST /api/payments/hubtel` reads `hubtel_settings` with the service role from a client-supplied business id, then returns HTTP 501. The response read on 11 October 2026 does not echo the secrets and does not take a payment.
- Severity: P2
- Evidence and source: `app/api/payments/hubtel/route.ts` on this branch, unchanged from HEAD.
- Reproduction status: Code path read. No runtime probe was sent.
- Root cause: The route has no session and no public token.
- Potential tenant impact: Confirms whether a business id has Hubtel settings configured.
- Financial or security impact: Information probe. Not a Service invoice settlement path.
- Affected code paths: `app/api/payments/hubtel/route.ts`
- Dependencies: Architectural review. This route is legacy settings execution, not the Service invoice checkout. Do not change it inside a Service package until that review says the change cannot affect Retail.
- Proposed remediation: Not authorized in this programme.
- Required tests: None until the review assigns an owner.
- Acceptance criteria: Not set. A Service package must not edit this file.
- Implementation status: CONFIRMED
- Release package: none — architectural review
- Owner: unassigned

## LED — Ledger and journal integrity

### LED-001

- Tracking ID: LED-001
- Original QA reference: none. Production read-only query, 10 October 2026.
- Module: General ledger
- Description: After excluding journals that reverse another entry or have themselves been reversed, two credit-note references still have a second live journal (extra debit GHS 35,550, two businesses) and one invoice reference has a second live journal (extra debit GHS 1,200, one business).
- Severity: P0
- Evidence and source: Read-only SQL on Finza Pro. No customer names stored in this register.
- Reproduction status: Confirmed as stored rows. Individual journals were not opened for commercial review.
- Root cause: See LED-002. These three groups are the live result.
- Potential tenant impact: Three businesses. Amounts are extra debits on a second live journal, not a system-wide total of all tenants.
- Financial or security impact: Revenue and receivables can be over-reversed or overstated for those source documents.
- Affected code paths: `post_credit_note_to_ledger`, `post_invoice_to_ledger`
- Dependencies: LED-002. Do not reverse the rows automatically.
- Proposed remediation: Package B investigates each journal, then a separate historical-correction approval. Not part of Package A.
- Required tests: A repeated post of the same source does not create a second live journal. Historical rows are listed before any correction.
- Acceptance criteria: Each of the three groups has a written keep-or-reverse decision. No bulk reversal.
- Implementation status: CONFIRMED
- Release package: B
- Owner: unassigned

### LED-002

- Tracking ID: LED-002
- Original QA reference: none
- Module: Journal posting
- Description: `journal_entries` has no unique key on `(reference_type, reference_id)` for invoices, payments, credit notes, bills, or expenses. Credit-note posting and bill posting do not take the advisory lock that expense posting takes. Reversals are a legitimate second row and must stay allowed.
- Severity: P0
- Evidence and source: Migrations and posting functions on `ee5cdb2`, read 10 October 2026. Payroll, reconciliation, and manual drafts already have unique indexes.
- Reproduction status: Control gap confirmed in code. Live duplicates other than LED-001 were not found for bills, bill payments, or sales after reversals were excluded.
- Root cause: Check-then-insert without a database constraint.
- Potential tenant impact: Every business that posts those document types.
- Financial or security impact: A repeated or overlapping request can post the same document twice.
- Affected code paths: `post_invoice_to_ledger`, `post_credit_note_to_ledger`, `post_bill_to_ledger`, `post_invoice_payment_to_ledger`, `post_bill_payment_to_ledger`, `post_expense_to_ledger`
- Dependencies: Shared `journal_entries` and `post_journal_entry`. Retail sales use `reference_type = sale`. A unique index is not authorized until a design shows it will not reject Retail sales, legitimate multi-entry workflows, or reversals.
- Proposed remediation: Package B design only until that review. Do not apply a constraint in Package A.
- Required tests: Second post returns the original journal. A reversal still inserts. A Retail sale post still inserts.
- Acceptance criteria: Architectural review approves the predicate before any migration is written.
- Implementation status: CONFIRMED
- Release package: B
- Owner: unassigned

### LED-003

- Tracking ID: LED-003
- Original QA reference: none
- Module: Expense journals
- Description: A first count of repeated expense references looked like duplicate postings of about GHS 1.4 million. After excluding reversals, no live duplicate expense group remained.
- Severity: Not rated
- Evidence and source: Read-only SQL, 10 October 2026.
- Reproduction status: The duplicate-expense claim was not reproduced for live journals.
- Root cause: Reversal rows share `reference_type` and `reference_id` with the original.
- Potential tenant impact: None identified from the live set.
- Financial or security impact: None confirmed.
- Affected code paths: expense posting and reversal
- Dependencies: LED-002 must not treat a reversal as a duplicate.
- Proposed remediation: No expense-journal correction from that count.
- Required tests: Reversal pairs are excluded from duplicate detection.
- Acceptance criteria: Package B does not reverse those expense pairs.
- Implementation status: NOT REPRODUCED
- Release package: B
- Owner: unassigned

### LED-004

- Tracking ID: LED-004
- Original QA reference: none
- Module: Accounts receivable control
- Description: One business has an orphan journal dated 10 May 2026, created 3 June 2026, description `Invoice #VERIFY-492-1780482856235`, debit and credit GHS 10, with no invoice row. It explains a GHS 10 gap between ledger receivables and operational receivables for that business.
- Severity: P2
- Evidence and source: Read-only ledger comparison during the invoice 46 investigation. Journal id `25d0863e-d1a4-4d44-aca4-aa29a0db8d24`.
- Reproduction status: Confirmed for that journal. Not shown to be a system-wide posting bug.
- Root cause: A journal was stored for a reference that has no invoice.
- Potential tenant impact: One business, GHS 10.
- Financial or security impact: Receivables control is high by GHS 10 for that business.
- Affected code paths: historical invoice posting. The October credit note on invoice 46 did not create this row.
- Dependencies: LED-001 review. Do not reverse without a separate data approval.
- Proposed remediation: Package B historical review for this journal only.
- Required tests: Posting an invoice requires the invoice row to exist. This historical row is not auto-deleted.
- Acceptance criteria: A written decision to keep or reverse this one journal.
- Implementation status: CONFIRMED
- Release package: B
- Owner: unassigned

## PAY — Payment processing and settlement

### PAY-001

- Tracking ID: PAY-001
- Original QA reference: none
- Module: Service Paystack settlement
- Description: On the production baseline, a Paystack charge that is only `pay_offline` or `send_otp` still inserts `payments`. That insert is what the payment trigger uses to post the ledger. `assertPaymentJournalPosted` then requires the journal.
- Severity: P0
- Evidence and source: `app/api/payments/paystack/charge/route.ts` on `ee5cdb2`. Branch returns before insert unless Paystack status is `success`, and a success whose metadata names another invoice is rejected. Jest on 11 October 2026 covered pending, failed, and bound success. No live charge was sent.
- Reproduction status: Confirmed in baseline code. Local tests passed. Not released.
- Root cause: The route treated provider acceptance of a prompt as a settled payment.
- Potential tenant impact: Every Service invoice paid through Paystack MoMo.
- Financial or security impact: A receivable can be cleared before the customer approves the prompt.
- Affected code paths: Paystack charge, verify, and OTP; `lib/payments/paystackInvoiceSettlement.ts`
- Dependencies: SEC-001, SEC-004, PAY-002. Does not change the shared payments trigger.
- Proposed remediation: Package A. Insert only after Paystack `success`, and return the existing row if that reference was already recorded.
- Required tests: Pending does not insert. Success inserts once. Second success does not insert again.
- Acceptance criteria: A non-success Paystack status creates no `payments` row and no payment journal.
- Implementation status: IMPLEMENTED UNVERIFIED
- Release package: A
- Owner: unassigned

### PAY-002

- Tracking ID: PAY-002
- Original QA reference: none
- Module: Service Paystack reference uniqueness
- Description: Two overlapping success polls can both pass the application "already posted" read and insert two payments. MTN and Hubtel invoice references already have partial unique indexes. Paystack invoice references (`FNZ-`, excluding `FNZ-SUB-`) do not, on the production baseline.
- Severity: P2
- Evidence and source: `supabase/migrations/415_payments_finza_mtn_reference_unique.sql` exists on the baseline. `588_paystack_invoice_payment_reference_unique.sql` is an untracked file. On 11 October 2026 it was applied to staging `adonhhtooawkeemdqqeo` after a zero-row preflight. It was not applied to production. The predicate also requires `deleted_at IS NULL`, because a failed ledger post soft-deletes the payment and a retry uses the same reference. Read-only SQL on Finza Pro (`qjxhibvbmzogyzbhswjj`) after that staging apply: index `payments_reference_fnz_invoice_unique` is absent; live `FNZ-` rows excluding `FNZ-SUB-` are 0. The earlier production check the same day found duplicate groups 0, and reference kinds 174 null and 18 other, with none `FNZ-`, `FNZ-SUB-`, `FZHB`, or `finza-mtn-`.
- Reproduction status: The race is confirmed by the code path. A live duplicate `FNZ-` group was not found in production. On staging, two inserts of `FNZ-PKG-A-CONC-20261011` were attempted. One row remained, the second returned `23505`, and one payment journal was posted. A soft-deleted row allowed a later insert of the same reference. Two `FNZ-SUB-` rows and two non-`FNZ-` rows were both accepted, then the synthetic fixture was deleted. This was SQL, not a Paystack verify request.
- Root cause: No unique index for that reference prefix.
- Potential tenant impact: Service Paystack invoice payments, only if two success requests overlap.
- Financial or security impact: Two ledger postings for one collection.
- Affected code paths: `lib/payments/paystackInvoiceSettlement.ts`, migration 588
- Dependencies: PAY-001. The index predicate excludes `FNZ-SUB-` and does not use Retail sale ids. Apply is still a production database change and is not authorized by this document.
- Proposed remediation: Staging now has the index. Production apply still requires a fresh read-only duplicate check and a separate owner approval, before success settlement is deployed there.
- Required tests: A second insert of the same `FNZ-` reference fails with unique violation and the route returns the first payment. Retail sale insert is unaffected.
- Acceptance criteria: The index exists in the target database before Paystack success settlement is enabled there. Apply recorded. Rollback is dropping that index only.
- Implementation status: IN PROGRESS
- Release package: A
- Owner: unassigned

## INV — Invoices, credit notes and receivables

### INV-001

- Tracking ID: INV-001
- Original QA reference: Not QA items 9 or 10. Those are INV-003 and INV-004. This entry is the production case where a full credit is stored and shown as paid.
- Module: Invoice status and presentation
- Description: `recalculate_invoice_status` sets `status = paid` and `paid_at` when invoice total minus payments minus applied credits is at or below zero, including when cash is zero. The production list and detail then say Paid or Paid in full.
- Severity: P0
- Evidence and source: Live function body contains the paid assignment after credits reduce outstanding (read 10 October 2026). Read-only count: 13 invoices, 4 businesses, invoice total GHS 59,539, status paid, cash zero, applied credits covering the total.
- Reproduction status: Confirmed in the function and in those rows.
- Root cause: `paid` means nothing left to collect, and the Service UI copies that word into a cash label.
- Potential tenant impact: Every business that fully credits an invoice. Four businesses already have rows in this state.
- Financial or security impact: Receivables math can stay correct while cash reporting and the customer-facing label are wrong. Overdue logic treats `paid` as settled.
- Affected code paths: `recalculate_invoice_status`; Service invoice list and detail on `ee5cdb2`; `app/api/reports/sales-summary/route.ts` (see INV-002)
- Dependencies: Do not change `recalculate_invoice_status` until overdue, receivables, and payment guards are listed and tested. The other worktree's display hotfix is not this branch.
- Proposed remediation: Package C. Separate cash collected, credits applied, outstanding, and fully settled in reports and labels. Preserve operational remaining balance.
- Required tests: Full credit is not labeled cash paid. Partial credit still shows a balance. Overdue still excludes drafts, cancelled invoices, and zero remaining. A failed amount load does not invent zero cash.
- Acceptance criteria: A fully credited invoice is not presented as cash received. Stored status is unchanged until a separate, tested status design is approved.
- Implementation status: CONFIRMED
- Release package: C
- Owner: unassigned

### INV-002

- Tracking ID: INV-002
- Original QA reference: none. Found while tracing INV-001.
- Module: Sales summary
- Description: `paidRevenue` adds the full invoice total for status `paid` or `partially_paid` and does not subtract applied credits or the unpaid remainder. `totalRevenue` does subtract applied credits.
- Severity: P1
- Evidence and source: `app/api/reports/sales-summary/route.ts` on `ee5cdb2`.
- Reproduction status: Confirmed in code. Not re-measured as a report total across tenants.
- Root cause: The report uses stored status as a proxy for cash.
- Potential tenant impact: Every business using that report.
- Financial or security impact: Credited and partly paid invoices can be reported as cash collected.
- Affected code paths: `GET` sales summary
- Dependencies: INV-001
- Proposed remediation: Package C. Compute cash from payments, credits from applied credit notes, and outstanding as the remainder.
- Required tests: Full credit adds nothing to cash collected. Partial payment adds only the cash amount.
- Acceptance criteria: The report's cash figure equals recorded payments for the period, not invoice totals of status `paid`.
- Implementation status: CONFIRMED
- Release package: C
- Owner: unassigned

### INV-003

- Tracking ID: INV-003
- Original QA reference: QA item 9. On a 2,000 invoice with 1,000 paid, the credit-note page shows paid 0, remaining 2,000, and balance after 1,500. The report says it should be 1,000 paid and 500 remaining. Reproduction steps were not supplied.
- Module: Credit note page
- Description: The credit-note screen, as reported, ignores the 1,000 cash already received when it shows paid, remaining, and balance after the credit.
- Severity: Not rated (QA class: critical)
- Evidence and source: QA report only. Not independently verified. This is not INV-001. The QA credit note left in the demo is CN-0003 for -500 on INV-000003, not the GHS 25,000 production credit.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA business, and any Service credit-note screen that uses the same figures.
- Financial or security impact: A user can see the wrong amount still owed. Not confirmed as a ledger posting error.
- Affected code paths: Not identified. Do not assume the credit-note API and the page share one calculation.
- Dependencies: INV-004. Package C. Do not change `recalculate_invoice_status` for this entry.
- Proposed remediation: Package C, after the page is reproduced on a fixture with a 2,000 invoice and a 1,000 payment. No code change is authorized by this entry.
- Required tests: Paid 1,000 and remaining 500 on that fixture. A full credit with zero cash stays distinct from INV-001.
- Acceptance criteria: The page shows cash paid and the amount still owed after the proposed credit. The QA example is reproduced or recorded as not reproduced against `support@finza.africa`.
- Implementation status: REPORTED
- Release package: C
- Owner: unassigned

### INV-004

- Tracking ID: INV-004
- Original QA reference: QA item 10. The credit-note form allows a credit of the full 2,000 when 1,000 is owed.
- Module: Credit note validation
- Description: The form, as reported, does not limit the credit to the unpaid remainder.
- Severity: Not rated (QA class: critical)
- Evidence and source: QA report only. Not independently verified. Capacity checks exist in `lib/creditNotes` tests on this branch. Those tests were not run against this QA example, and a passing capacity test would not close this entry.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. The form and the API may disagree.
- Potential tenant impact: The QA business, and any user of the same form.
- Financial or security impact: A credit larger than the amount owed would overstate the credit and misstate receivables if it is posted. Posting was not confirmed.
- Affected code paths: Not identified.
- Dependencies: INV-003. Shared credit-note validation, if the API is the same path Service and other workspaces use. Do not authorize a shared change.
- Proposed remediation: Package C. Reproduce on a fixture before any validation change.
- Required tests: A credit above cash-unpaid remainder is rejected. A credit of the unpaid remainder is accepted. Overpayment remains blocked, as the QA "what works" note described.
- Acceptance criteria: The form cannot submit a credit above the unpaid remainder, and the API rejects it as well.
- Implementation status: REPORTED
- Release package: C
- Owner: unassigned

## FIN — Financial reporting

### FIN-001

- Tracking ID: FIN-001
- Original QA reference: QA item 1, custom range 2026. This entry is the date-range code defect. The all-zero screen itself is FIN-006. The QA amounts were not remeasured.
- Module: Trial balance
- Description: A custom start and end date does not filter journals. `resolveAccountingPeriodForReport` keeps the start date and loads the monthly period that contains it. `end_date` is not used.
- Severity: P1
- Evidence and source: `lib/accounting/resolveAccountingPeriodForReport.ts` and `get_trial_balance_from_snapshot` on `ee5cdb2`.
- Reproduction status: Confirmed in code. A live UI session was not opened.
- Root cause: The report API resolves one accounting period, then reads that period's snapshot.
- Potential tenant impact: Every custom-range trial balance.
- Financial or security impact: The statement can omit or include a different month than the one requested.
- Affected code paths: `app/api/accounting/reports/trial-balance/route.ts`, snapshot RPC
- Dependencies: FIN-002, FIN-003. Calling `get_trial_balance_from_snapshot` can regenerate a stale snapshot. That is a write. Do not call it during read-only checks.
- Proposed remediation: Package D. The requested dates must be the journal filter. Shared reporting. Review Retail report callers before editing the shared resolver.
- Required tests: A range that crosses two months returns both months. A range inside one month does not include the rest of the month when the request ends earlier.
- Acceptance criteria: Account totals match journal lines in the requested dates, including the prior-period opening the statement defines.
- Implementation status: CONFIRMED
- Release package: D
- Owner: unassigned

### FIN-002

- Tracking ID: FIN-002
- Original QA reference: QA item 1, the report says the zero trial balance "says Balanced". This entry is that label behavior in code. It does not by itself prove the QA screen was empty.
- Module: Trial balance
- Description: Both trial-balance routes treat period debits of 0 and credits of 0 as balanced. An empty snapshot is therefore reported as balanced.
- Severity: P1
- Evidence and source: Accounting and reports trial-balance routes, and `generate_trial_balance`, on `ee5cdb2`.
- Reproduction status: Confirmed in code.
- Root cause: The balance test is absolute difference under 0.01, which is true when both sides are zero.
- Potential tenant impact: Any business whose snapshot has no rows.
- Financial or security impact: A missing snapshot can be presented as a balanced ledger.
- Affected code paths: `app/api/accounting/trial-balance/route.ts`, `app/api/accounting/reports/trial-balance/route.ts`
- Dependencies: FIN-001, FIN-003
- Proposed remediation: Package D. Distinguish no data from a balanced non-empty result.
- Required tests: Empty result is not labeled balanced. A real balanced period still is.
- Acceptance criteria: The UI cannot show "balanced" when no account rows were returned.
- Implementation status: CONFIRMED
- Release package: D
- Owner: unassigned

### FIN-003

- Tracking ID: FIN-003
- Original QA reference: none
- Module: Trial-balance snapshots
- Description: On 10 October 2026, 32 snapshots were `is_stale` across 15 businesses. The snapshot is regenerated on read only when missing or stale. Journal line inserts, updates, and deletes do not mark it stale. Invalidation failures are swallowed.
- Severity: P1
- Evidence and source: Read-only count on `trial_balance_snapshots`. Trigger is `AFTER INSERT` on `journal_entries` only, migration 247.
- Reproduction status: Stale rows confirmed. The UI was not opened, and the regenerate function was not called.
- Root cause: Staleness follows journal headers, not lines, and a failed invalidation does not stop the insert.
- Potential tenant impact: 15 businesses already had a stale flag. Any business can be served an old snapshot when the flag is false.
- Financial or security impact: Reports can disagree with journals posted after the snapshot.
- Affected code paths: `get_trial_balance_from_snapshot`, `invalidate_snapshot_on_journal_entry`
- Dependencies: FIN-001. Shared snapshot tables. Do not regenerate all snapshots in the same change as a code deploy.
- Proposed remediation: Package D. Invalidate on line changes. Do not hide a stale snapshot as current.
- Required tests: A journal line change marks the period stale. A read does not silently rebuild during an unrelated request in tests.
- Acceptance criteria: A report either shows data that includes the latest lines or states that the snapshot is stale.
- Implementation status: CONFIRMED
- Release package: D
- Owner: unassigned

### FIN-004

- Tracking ID: FIN-004
- Original QA reference: QA item 3. October changes in equity opening 0, closing 5,041.67; balance sheet equity 345.26. Those cedis were not re-calculated.
- Module: Changes in equity and balance sheet
- Description: The equity statement uses one month of movements plus that month's profit. The balance sheet adds cumulative net income through the as-of date. Period close does not journal profit into retained earnings, so prior unclosed profit can sit on the balance sheet and not on the equity statement.
- Severity: P1
- Evidence and source: `getEquityChangesReport` and `getBalanceSheetReport` on `ee5cdb2`.
- Reproduction status: Confirmed in code. The QA figures 5,041.67 and 345.26 were not re-calculated. QA also reported the balance sheet itself balanced, which is a different statement from this equity mismatch.
- Root cause: The two reports do not use the same date window or the same earnings source.
- Potential tenant impact: Every business with profit outside a single open month.
- Financial or security impact: Equity and the balance sheet do not reconcile.
- Affected code paths: `lib/accounting/reports/getEquityChangesReport.ts`, balance sheet report, `get_cumulative_net_income_as_of`
- Dependencies: FIN-001. Shared reports. Retail callers of the same functions must be listed before an edit.
- Proposed remediation: Package D. Use the balance sheet's cumulative earnings on the equity statement for the same as-of date.
- Required tests: One fixture where profit exists before the selected month. Equity closing plus liabilities equals assets.
- Acceptance criteria: For the same business and as-of date, the equity statement's closing total equals the balance sheet equity section.
- Implementation status: CONFIRMED
- Release package: D
- Owner: unassigned

### FIN-005

- Tracking ID: FIN-005
- Original QA reference: The "what works" note says cash-flow closing cash equalled balance sheet cash on this test. That observation does not clear this code path.
- Module: Cash flow
- Description: Cash-flow closing cash sums asset codes 1000–1099. Withholding-tax receivable is asset 2155, so a customer withholding is not in the working-capital section. The balance sheet still includes 2155.
- Severity: P2
- Evidence and source: `getCashFlowReport` and `create_system_accounts` on `ee5cdb2`.
- Reproduction status: Code path confirmed. The cedis amount was not summed.
- Root cause: 2155 falls outside the cash and working-capital bands the report classifies.
- Potential tenant impact: Businesses whose customers withhold tax.
- Financial or security impact: Indirect cash flow does not tie to ledger cash when 2155 moves.
- Affected code paths: `lib/accounting/reports/getCashFlowReport.ts`
- Dependencies: TAX-001 is a different withholding path. Shared report. List Retail callers before editing.
- Proposed remediation: Package D. Classify 2155 as a working-capital movement, not as cash.
- Required tests: A fixture with a withholding on a receipt ties cash-flow closing cash to accounts 1000–1099.
- Acceptance criteria: Closing cash equals the cash and bank accounts on the balance sheet for the same as-of date.
- Implementation status: CONFIRMED
- Release package: D
- Owner: unassigned

### FIN-006

- Tracking ID: FIN-006
- Original QA reference: QA item 1. Trial balance 0.00 on every account for custom range 2026 and period 2026-10, while labelled Balanced. Expected totals were not stated.
- Module: Trial balance
- Description: The stored October snapshot examined during the earlier check was stale and non-zero. It was not an all-zero snapshot. The live screen was not opened. That check was not identified as the QA login `support@finza.africa`, so it does not clear QA item 1.
- Severity: Not rated
- Evidence and source: Read-only snapshot row, 10 October 2026. `generate_trial_balance` was not called.
- Reproduction status: The all-zero symptom was not present in that stored snapshot.
- Root cause: Not established for a zero display. See FIN-002 for how an empty result would be labeled balanced.
- Potential tenant impact: Not established.
- Financial or security impact: Not established from the stored row.
- Affected code paths: snapshot read
- Dependencies: FIN-002, FIN-003
- Proposed remediation: Do not "fix" historical snapshots to explain a screen that was not reproduced. Package D covers the code defects.
- Required tests: None beyond FIN-002 until someone reproduces a zero screen.
- Acceptance criteria: A reproduced zero screen is linked to a snapshot id before any data repair.
- Implementation status: NOT REPRODUCED
- Release package: D
- Owner: unassigned

### FIN-007

- Tracking ID: FIN-007
- Original QA reference: QA item 26. Period 2026-01 appears in Periods, Cash Flow, and Equity, and does not appear in trial balance, balance sheet, or profit and loss.
- Module: Accounting periods
- Description: The report says the same period is listed on some statements and omitted on others.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA business. Any shared period picker would widen that.
- Financial or security impact: A reader can use different period sets on different statements. No amount was stated.
- Affected code paths: Not identified. Period lists are shared reporting. Do not authorize an edit.
- Dependencies: FIN-001. Package D.
- Proposed remediation: Package D, after a review of which screens share the period query. No change is authorized.
- Required tests: One business with a January period shows that period on every statement that claims to list open periods, or the omitted statement explains why.
- Acceptance criteria: The QA discrepancy is reproduced on a named screen pair, or recorded as not reproduced.
- Implementation status: REPORTED
- Release package: D
- Owner: unassigned

## TAX — VAT and statutory taxation

### TAX-001

- Tracking ID: TAX-001
- Original QA reference: QA item 4 is the filing arithmetic (output 583.34, input 575.01, net shown 6.25, expected output about 250). Those figures are TAX-003 and TAX-004. This entry is the separate code path that treats liability debits as input tax. The QA figures were not recomputed.
- Module: Ghana VAT return
- Description: From 1 January 2026, net VAT payable is output VAT, NHIL, and GETFund minus every debit on those liability accounts. A payment of the liability is a debit, so it is treated like input tax. A missing control account still returns a zero row.
- Severity: P1
- Evidence and source: `app/api/vat-returns/calculate/route.ts` and `extract_tax_return_from_ledger` on `ee5cdb2`. Ghana only.
- Reproduction status: Confirmed in code. A filed return was not recomputed.
- Root cause: The return uses all period debits on the liability accounts as input tax.
- Potential tenant impact: Ghana businesses that pay VAT, NHIL, or GETFund.
- Financial or security impact: A settlement payment can reduce the return's net payable as if it were input tax.
- Affected code paths: VAT return calculate route, ledger extract function
- Dependencies: Shared tax function. List Retail sale tax postings before changing the function.
- Proposed remediation: Package E. Separate tax accrual from settlement of the liability.
- Required tests: A payment of VAT payable does not increase input tax. A supplier bill's input VAT still does.
- Acceptance criteria: Input tax equals purchase-side tax only. Liability settlements stay on the balance sheet.
- Implementation status: CONFIRMED
- Release package: E
- Owner: unassigned

### TAX-002

- Tracking ID: TAX-002
- Original QA reference: none
- Module: Ghana VAT return
- Description: The same function leaves COVID out of net payable when the period ends on or after 1 January 2026, while NHIL and GETFund remain inside it. Whether that matches the statutory return was not verified against a GRA worksheet.
- Severity: Not rated
- Evidence and source: Code read on `ee5cdb2`.
- Reproduction status: Behavior observed in code. Not established as a defect.
- Root cause: Not established.
- Potential tenant impact: Unknown until compared with the statutory form.
- Financial or security impact: Unknown.
- Affected code paths: `extract_tax_return_from_ledger`
- Dependencies: TAX-001
- Proposed remediation: Do not change COVID treatment until a statutory check is written down.
- Required tests: None until the statutory result is specified.
- Acceptance criteria: A written comparison to the post-2026 return before any code change.
- Implementation status: NEEDS REPRODUCTION
- Release package: E
- Owner: unassigned

### TAX-003

- Tracking ID: TAX-003
- Original QA reference: QA item 4, first clause. October VAT filings show output 583.34 minus input 575.01, which is 8.33, while net shown is 6.25.
- Module: VAT filing display
- Description: The reported net does not equal the reported output minus the reported input.
- Severity: Not rated (QA class: critical)
- Evidence and source: QA report only. Not independently verified. TAX-001 is a different code finding and does not explain 6.25 by itself.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA business's October filing screen.
- Financial or security impact: The filed net can disagree with the components on the same screen. Not confirmed.
- Affected code paths: Not identified. The VAT extract is shared. Do not authorize a change.
- Dependencies: TAX-001, TAX-004. Package E.
- Proposed remediation: Reproduce the October screen on a fixture before any formula change.
- Required tests: Net equals output minus input for the same definition of input. A liability payment is not input (TAX-001).
- Acceptance criteria: The 6.25 figure is traced to a field, or the entry is recorded as not reproduced.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-004

- Tracking ID: TAX-004
- Original QA reference: QA item 4, second clause. Output should be about 250, and the screen showed 583.34.
- Module: VAT output
- Description: The reported output is higher than the tester's expected output. The report uses "about 250" and does not show the worksheet.
- Severity: Not rated (QA class: critical)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA business's October output tax.
- Financial or security impact: Output tax may be overstated. Not confirmed. The expected figure is approximate.
- Affected code paths: Not identified. Shared tax calculation. Do not authorize a change.
- Dependencies: TAX-003. The "what works" note says invoice VAT, NHIL, and GETFund posted. That does not clear this filing total.
- Proposed remediation: Package E. Obtain the document list behind "about 250" before changing a rate or a sum.
- Required tests: A fixture whose expected output is calculated, not approximated, matches the filing output.
- Acceptance criteria: Output on the filing equals the sum of output tax on the included documents for that period.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-005

- Tracking ID: TAX-005
- Original QA reference: QA item 28. A tax-inclusive 2,000 gives base 1,666.66. The report says the exact base is 1,666.67.
- Module: Tax rounding
- Description: Inclusive-tax back-calculation, as reported, is short by 0.01 on a 2,000 gross amount.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified. Ghana post-2026 inclusive math is a shared tax path. Do not authorize a change.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Every tax-inclusive 2,000 document if the same rounding is used.
- Financial or security impact: One pesewa on the taxable base. Not confirmed.
- Affected code paths: Not identified.
- Dependencies: TAX-006. Package E.
- Proposed remediation: Package E, after the shared tax engine is identified and Retail callers are listed.
- Required tests: 2,000 inclusive rounds to the base the statutory split requires, and the parts still sum to 2,000.
- Acceptance criteria: The QA example is reproduced on a named calculator, or recorded as not reproduced.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-006

- Tracking ID: TAX-006
- Original QA reference: Incomplete item. Prices are tax-inclusive only. There is no exclusive option.
- Module: Document pricing
- Description: The report says the tester could not enter a tax-exclusive price.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. Pricing may be shared with other workspaces. Do not authorize a change.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. This may be a product limit rather than a calculation defect.
- Potential tenant impact: Users who need to quote exclusive prices.
- Financial or security impact: None confirmed.
- Affected code paths: Not identified.
- Dependencies: TAX-005. Package E. Product decision required.
- Proposed remediation: Do not add an exclusive mode until the owner decides the product behavior.
- Required tests: None until that decision names the screens.
- Acceptance criteria: The owner either accepts inclusive-only pricing or names the screens that must offer exclusive entry.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-007

- Tracking ID: TAX-007
- Original QA reference: Incomplete item. No COVID levy option, although the account exists. The service tax code is free text.
- Module: Tax codes
- Description: The report says COVID cannot be selected, and the tax code field does not constrain the value.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. TAX-002 is the net-payable formula, not this control.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Ghana businesses if the control is missing on the Service document form.
- Financial or security impact: Unknown. A free-text tax code can post to an unintended account if the server trusts it. That posting path was not traced.
- Affected code paths: Not identified. Do not authorize a tax-code change.
- Dependencies: TAX-002. Package E. Product decision required for whether COVID remains selectable after 2025.
- Proposed remediation: No code change until the statutory choice and the free-text save path are both written down.
- Required tests: None until that note exists.
- Acceptance criteria: The owner states whether COVID can be selected, and whether tax code is a list or free text.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-008

- Tracking ID: TAX-008
- Original QA reference: Incomplete item. E-VAT and VAT filing are internal drafts only. Nothing is submitted to GRA.
- Module: VAT filing
- Description: The report describes filing as an internal draft, not a GRA submission.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. This reads as a product boundary, not a wrong number.
- Potential tenant impact: Users who expect a GRA submission from the filing screen.
- Financial or security impact: None confirmed. A draft must not be described as filed with GRA.
- Affected code paths: Not identified.
- Dependencies: TAX-003. Package E. Product decision.
- Proposed remediation: Do not build a GRA submission in this programme unless the owner adds it.
- Required tests: None until that scope exists.
- Acceptance criteria: The filing screen's wording matches the product boundary the owner confirms.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-009

- Tracking ID: TAX-009
- Original QA reference: Incomplete item, first clause. No automatic corporate income tax provision.
- Module: Income tax
- Description: The report says the product does not raise an automatic CIT provision.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. Product scope, not a confirmed misstatement.
- Potential tenant impact: Businesses that expect a tax provision in profit.
- Financial or security impact: None confirmed.
- Affected code paths: Not identified.
- Dependencies: None. Package E. Product decision.
- Proposed remediation: Do not add a CIT journal until the owner specifies the rate, the period, and the accounts.
- Required tests: None until that specification exists.
- Acceptance criteria: The owner accepts the absence, or names the provision rule.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### TAX-010

- Tracking ID: TAX-010
- Original QA reference: Incomplete item, second clause. The withholding-tax register is empty.
- Module: Withholding tax
- Description: The report says the withholding-tax register showed no rows.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. FIN-005 is the cash-flow treatment of account 2155, not this register.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. Empty may mean no withholding was recorded, or the register does not read the ledger.
- Potential tenant impact: The QA business's withholding register.
- Financial or security impact: Unknown until the register is compared with withholding journals.
- Affected code paths: Not identified.
- Dependencies: FIN-005. Package E.
- Proposed remediation: Package E. Compare the register to withholding journals for the QA business before treating emptiness as a defect.
- Required tests: A known withholding journal appears on the register, or the register states that it is not built.
- Acceptance criteria: The empty register is explained by data or by a missing query. No production correction from this entry.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

## PRL — Payroll

### PRL-001

- Tracking ID: PRL-001
- Original QA reference: Related to QA item 6. The reported profit amount is PRL-005 (4,100 + 596.41). This entry is the missing status check in the function.
- Module: Payroll posting
- Description: `post_payroll_to_ledger` does not test run status. It debits payroll expense and employer pension. It is executable by `authenticated`. Approval posts while the run is still draft, then sets status approved, inside one function.
- Severity: P2
- Evidence and source: Migrations 553 and 556 on `ee5cdb2`. Read-only count on 10 October 2026: 0 draft runs with a journal, 0 approved runs without a journal.
- Reproduction status: The missing status check is confirmed in the function. A draft run sitting in the ledger was not found.
- Root cause: The expense post is not guarded by status inside the ledger function.
- Potential tenant impact: Any business whose user can call the function directly.
- Financial or security impact: A direct call can put draft payroll into profit and loss.
- Affected code paths: `post_payroll_to_ledger`, `approve_payroll_run_atomic`
- Dependencies: PRL-004, PRL-005. Service payroll. Do not change Retail pay.
- Proposed remediation: Package E. The database function rejects a run that is not in the approved posting step.
- Required tests: A draft run does not post. Approve posts once. A second approve does not post again.
- Acceptance criteria: Direct execution on a draft raises an error and leaves no journal.
- Implementation status: CONFIRMED
- Release package: E
- Owner: unassigned

### PRL-002

- Tracking ID: PRL-002
- Original QA reference: QA item 5. Payroll "test" employee, basic 100, SSNIT shown 32.33 employee and about 76.41 employer. Expected 5.50 and 13.00. The report also says normal salaries of 3,000 and 1,000 matched Ghana bands.
- Module: Payroll statutory amounts
- Description: Stored October and November payroll rows that were read did not match the figures then described in the remediation request. Those rows were not identified as this basic-100 test employee, and the check was not identified as `support@finza.africa`. QA item 5 is therefore not cleared.
- Severity: Not rated
- Evidence and source: Read-only payroll rows, 10 October 2026.
- Reproduction status: Not reproduced.
- Root cause: Not established.
- Potential tenant impact: Not established.
- Financial or security impact: Not established.
- Affected code paths: payroll calculation
- Dependencies: PRL-001
- Proposed remediation: Do not adjust stored SSNIT from the missing report.
- Required tests: None until the source figures are produced.
- Acceptance criteria: A named pay run and the source figure are both in hand before any change.
- Implementation status: NOT REPRODUCED
- Release package: E
- Owner: unassigned

### PRL-003

- Tracking ID: PRL-003
- Original QA reference: QA item 11. Two July 2026 salary runs for the same period. No run ids were stated.
- Module: Payroll runs
- Description: One live July 2026 approved run was found for the business discussed in the earlier request. A second live July run was not found. That check was not identified as the QA login, so QA item 11 is not cleared. No payroll row was changed.
- Severity: Not rated
- Evidence and source: Read-only payroll query, 10 October 2026.
- Reproduction status: Not reproduced.
- Root cause: Not established.
- Potential tenant impact: Not established.
- Financial or security impact: Not established.
- Affected code paths: payroll run creation
- Dependencies: none
- Proposed remediation: No data change.
- Required tests: None.
- Acceptance criteria: A second run id must be shown before any duplicate repair.
- Implementation status: NOT REPRODUCED
- Release package: E
- Owner: unassigned

### PRL-004

- Tracking ID: PRL-004
- Original QA reference: QA item 12. Approve fails with `PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED` (missing TIN/GRA position). The page says approval is still possible. Reproduction steps were not supplied.
- Module: Payroll approval
- Description: `PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED` is raised inside approval, after the journal insert and before status becomes approved, so a failure should roll the journal back. The QA failure was not replayed. The UI copy that says the user can still approve was not checked.
- Severity: Not rated
- Evidence and source: Migration 560 and approval function on `ee5cdb2`. `lib/payroll/__tests__/ghanaApprovalGuards.test.ts` and `mapApprovePayrollAtomicError.test.ts` exist. They were not executed for this programme.
- Reproduction status: Needs reproduction of the reported failure.
- Root cause: Not established for the reported incident.
- Potential tenant impact: Unknown.
- Financial or security impact: Unknown. The intended control is rollback.
- Affected code paths: `create_payroll_export_snapshots_for_approval`, `approve_payroll_run_atomic`
- Dependencies: PRL-001
- Proposed remediation: Package E only after the failing payload is reproduced.
- Required tests: The reported identity or column failure rolls back the journal.
- Acceptance criteria: The original error can be produced on a synthetic fixture, and the run stays draft with no journal.
- Implementation status: NEEDS REPRODUCTION
- Release package: E
- Owner: unassigned

### PRL-005

- Tracking ID: PRL-005
- Original QA reference: QA item 6. 2026 profit and loss carries payroll expense equal to the unapproved October draft, 4,100 + 596.41. The report also says that draft was not approved and nothing was paid.
- Module: Profit and loss
- Description: No draft payroll run currently carried a journal in the 10 October count. The amount 4,100 + 596.41 was not matched to a journal. That count was not identified as the QA login, so QA item 6 is not cleared.
- Severity: Not rated
- Evidence and source: Read-only count of draft runs with `journal_entry_id`.
- Reproduction status: Needs reproduction of the reported profit figure.
- Root cause: Not established for that figure. The code path is PRL-001.
- Potential tenant impact: Not established from the stored runs.
- Financial or security impact: Not established for the reported amount.
- Affected code paths: payroll ledger post, profit and loss
- Dependencies: PRL-001
- Proposed remediation: Do not adjust profit and loss. Close the function gap under PRL-001.
- Required tests: Covered by PRL-001 once a fixture exists.
- Acceptance criteria: The reported amount is traced to a journal id or closed as not reproduced.
- Implementation status: NEEDS REPRODUCTION
- Release package: E
- Owner: unassigned

### PRL-006

- Tracking ID: PRL-006
- Original QA reference: Incomplete item. Employer SSNIT is not shown per employee on payroll lines.
- Module: Payroll display
- Description: The report says employer SSNIT is missing from the employee lines. It does not say the ledger omitted the employer amount.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. QA item 5 is the wrong amount on a basic-100 employee, which is PRL-002.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Payroll users on the QA business.
- Financial or security impact: None confirmed. A hidden employer amount can still be posted.
- Affected code paths: Not identified.
- Dependencies: PRL-002. Package E.
- Proposed remediation: Package E. Confirm the line layout before adding a column.
- Required tests: An approved fixture shows employer SSNIT on the line once the owner asks for that column.
- Acceptance criteria: The owner accepts the current layout, or the line shows the employer amount that was calculated.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

### PRL-007

- Tracking ID: PRL-007
- Original QA reference: Incomplete item, third clause. DT 107A export is "verification only".
- Module: PAYE export
- Description: The report says the DT 107A export does not complete a filing. It does not describe a wrong PAYE figure. The "what works" note says PAYE was correct for salaries of 3,000 and 1,000.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. `graDt107aPayeExport.test.ts` exists and was not run for this programme.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. Product boundary unless a wrong export value is shown.
- Potential tenant impact: Users who expect the export to file PAYE.
- Financial or security impact: None confirmed.
- Affected code paths: Not identified.
- Dependencies: PRL-004. Package E. Product decision.
- Proposed remediation: Do not extend the export until the owner defines the filing scope.
- Required tests: None until that scope exists.
- Acceptance criteria: The export label matches the owner's decision.
- Implementation status: REPORTED
- Release package: E
- Owner: unassigned

## BNK — Banking and reconciliation

### BNK-001

- Tracking ID: BNK-001
- Original QA reference: QA item 7. System balance -5,200 versus ledger cash +2,027.50. Picker lists accounts receivable, fixed assets, and withholding-tax receivable. Those cedis were not remeasured.
- Module: Bank reconciliation
- Description: The account picker requests every asset. Book lines treat a bank debit as a decrease. Period movement does not start from the opening balance.
- Severity: P1
- Evidence and source: `BankReconciliationScreen` and `app/api/reconciliation/[accountId]/transactions/route.ts` on `ee5cdb2`. Opening balance uses debit minus credit for assets.
- Reproduction status: Confirmed in code. A live reconciliation was not completed.
- Root cause: The screen is not limited to cash and bank, and the movement sign does not follow the asset normal balance.
- Potential tenant impact: Every business using this screen.
- Financial or security impact: The book balance can have the wrong sign and the wrong account.
- Affected code paths: reconciliation accounts route and the screen above
- Dependencies: Shared reconciliation UI and APIs. Do not edit until a review shows Retail does not use the same screen, or the review approves a Service-only wrapper. This programme does not authorize the shared edit.
- Proposed remediation: Package F, after that review. Limit eligibility to cash and bank. Treat an asset debit as an increase. Include opening balance.
- Required tests: An expense account is not offered. A debit increases the book balance. Opening balance is the start of the period.
- Acceptance criteria: Book balance equals the asset balance of the selected cash or bank account.
- Implementation status: CONFIRMED
- Release package: F
- Owner: unassigned

### BNK-002

- Tracking ID: BNK-002
- Original QA reference: Incomplete item. "Reconciliation page is empty." QA item 7 separately describes a bank reconciliation with a system balance and a ledger balance, so these may be two screens.
- Module: Reconciliation
- Description: The report says one reconciliation page had no content. It does not name the route.
- Severity: Not rated (QA class: incomplete)
- Evidence and source: QA report only. Not independently verified. BNK-001 remains the sign and account-picker defect.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Unknown until the page is named.
- Financial or security impact: Unknown. An empty page can hide the balances in BNK-001 or can be an unfinished screen.
- Affected code paths: Not identified. The reconciliation screen is shared. Do not authorize a change.
- Dependencies: BNK-001. Package F. Needs clarification before implementation.
- Proposed remediation: Identify the empty page before any edit. Do not treat this as the same fix as BNK-001.
- Required tests: None until the route is named.
- Acceptance criteria: The empty page is identified, or this entry is recorded as the same screen as BNK-001.
- Implementation status: REPORTED
- Release package: F
- Owner: unassigned

## MAT — Service materials and inventory

### MAT-001

- Tracking ID: MAT-001
- Original QA reference: QA item 2, in part. Buying 800 and using 240 of QA Cement is MAT-003. This entry is the usage-trigger gap found in code. The 800 and 240 quantities were not counted.
- Module: Service material usage
- Description: Cost of goods is posted only when usage status is updated to `consumed`. An insert that is already `consumed` does not post. A purchase with `material_id` debits inventory 1450, not 5110.
- Severity: P2
- Evidence and source: Migration 327 trigger and migration 535 posting function on `ee5cdb2`.
- Reproduction status: Confirmed in code. Usage rows that skipped posting were not counted.
- Root cause: The ledger trigger is `AFTER UPDATE OF status`, not insert.
- Potential tenant impact: Service businesses that insert usage as consumed.
- Financial or security impact: Inventory can leave the operational record without a cost journal.
- Affected code paths: `post_service_job_material_usage_to_ledger`, bill material posting in migration 548
- Dependencies: Service tables. Confirm the trigger is not used by Retail stock before any edit.
- Proposed remediation: Package F. Post when the row is consumed, including insert-as-consumed. Do not turn purchases into cost of goods.
- Required tests: Insert as consumed posts Dr 5110 / Cr 1450 once. A later update does not post again. A purchase still debits 1450.
- Acceptance criteria: Consumed usage and the ledger stay in balance, and purchases remain inventory.
- Implementation status: CONFIRMED
- Release package: F
- Owner: unassigned

### MAT-002

- Tracking ID: MAT-002
- Original QA reference: QA item 2 names QA Cement. The stock row found in the earlier check is a different observation: quantity 1,815, average cost 89, updated 29 July 2026.
- Module: Service materials
- Description: Cement in the checked business is a service material, quantity 1,815, average cost 89, last updated 29 July 2026. It is not a product row. No invoice total of exactly 2000 was found in that check. That row does not match a buy of 800 and a use of 240, and the check was not identified as the QA login. QA item 2 is not cleared.
- Severity: Not rated
- Evidence and source: Read-only query, 10 October 2026.
- Reproduction status: Not reproduced as a product or as that invoice.
- Root cause: Not established.
- Potential tenant impact: Not established.
- Financial or security impact: Not established.
- Affected code paths: `service_material_inventory`
- Dependencies: MAT-001
- Proposed remediation: No stock adjustment from the missing QA file.
- Required tests: None.
- Acceptance criteria: A source quantity and a stock-movement id are required before any correction.
- Implementation status: NOT REPRODUCED
- Release package: F
- Owner: unassigned

### MAT-003

- Tracking ID: MAT-003
- Original QA reference: QA item 2. Buying 800 and using 240 of QA Cement never posted to inventory, cost of sales, cash, or payables.
- Module: Service material purchase and usage
- Description: The report says both the purchase and the usage of QA Cement left no ledger entries on inventory, cost of sales, cash, or payables.
- Severity: Not rated (QA class: critical)
- Evidence and source: QA report only. Not independently verified. MAT-001 explains a usage trigger that posts only on status update. It does not explain a purchase that misses cash and payables. MAT-002 is a different cement quantity and does not clear this item.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA business's cement stock and any Service material purchase that uses the same path.
- Financial or security impact: Inventory, cost, cash, and payables can omit the purchase and the usage. Not confirmed for the 800 and 240.
- Affected code paths: Not identified beyond the usage trigger in MAT-001. Confirm the purchase path is not a Retail stock table before any edit. Do not authorize a change.
- Dependencies: MAT-001, MAT-002. Package F.
- Proposed remediation: Package F. Trace QA Cement's purchase document and usage row before posting a correction. No stock adjustment from this entry.
- Required tests: A material purchase debits inventory and credits payables or cash. A usage of 240 posts cost once. Retail stock is unchanged.
- Acceptance criteria: The 800 and 240 are found on a document and either matched to journals or shown to have no journals.
- Implementation status: REPORTED
- Release package: F
- Owner: unassigned

## DOC — Quotes, proposals and document workflows

### DOC-001

- Tracking ID: DOC-001
- Original QA reference: QA item 8. QUO-0001 converted to an invoice twice in the same minute. The report does not give the two invoice numbers.
- Module: Quote to invoice
- Description: `POST /api/estimates/convert/[id]` reads `converted_to`, inserts a draft invoice, then updates the estimate. There is no conditional update and no unique link from the invoice back to the estimate. Two overlapping requests can both see a null conversion.
- Severity: P1
- Evidence and source: The convert route and migration 077 on `ee5cdb2`. A duplicate pair was not counted. An earlier read found one quote numbered QUO-0001 with status rejected, total 3,950, and no conversion. That row was not shown to be the QA quote, so it does not clear QA item 8.
- Reproduction status: Confirmed in code. A stored duplicate pair was not looked up.
- Root cause: Check-then-act without a uniqueness constraint.
- Potential tenant impact: Every business that converts quotes.
- Financial or security impact: Two draft invoices for one quote. They are not posted until issued, but both can be issued later.
- Affected code paths: `app/api/estimates/convert/[id]/route.ts`. The other convert route returns 410.
- Dependencies: Service estimates. Confirm Retail does not call this route before editing.
- Proposed remediation: Package G. Update the estimate only where `converted_to` is null, and store the invoice id.
- Required tests: Two concurrent converts produce one invoice. A second request returns the first invoice.
- Acceptance criteria: One quote has at most one converted invoice.
- Implementation status: CONFIRMED
- Release package: G
- Owner: unassigned

### DOC-002

- Tracking ID: DOC-002
- Original QA reference: QA item 13. A quote with a material line cannot be saved. It requires supply mode, and the form has no control for it.
- Module: Quote materials
- Description: The report says save is blocked on a missing supply-mode control.
- Severity: Not rated (QA class: blocking)
- Evidence and source: QA report only. Not independently verified. Previously held only as part of QA-001.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service quotes that include a material line.
- Financial or security impact: The quote cannot be saved. No wrong ledger amount was stated.
- Affected code paths: Not identified. Service quote form. Confirm Retail quotes do not share the control before any edit. Do not authorize a change.
- Dependencies: MAT-003. Package G.
- Proposed remediation: Package G. Reproduce the save error, then add the control or stop requiring it.
- Required tests: A quote with a material line saves when supply mode is chosen. A quote without a material line still saves.
- Acceptance criteria: The reported save error is reproduced, and the form exposes the required choice.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### DOC-003

- Tracking ID: DOC-003
- Original QA reference: QA item 14. Quote email to a bad address failed, yet status became Sent.
- Module: Quote email
- Description: The report says a failed send still marked the quote sent.
- Severity: Not rated (QA class: blocking)
- Evidence and source: QA report only. Not independently verified. Previously held only as part of QA-001.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service quotes that are emailed.
- Financial or security impact: The document status can say the customer was sent a quote when the send failed. Not confirmed.
- Affected code paths: Not identified.
- Dependencies: Package G. Do not change a shared email status if Retail uses the same field, until that is listed.
- Proposed remediation: Package G. Set Sent only after the provider accepts the message.
- Required tests: A rejected address leaves the quote unsent. A successful send marks it sent.
- Acceptance criteria: The QA case is reproduced with a failed provider response and an unchanged status.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### DOC-004

- Tracking ID: DOC-004
- Original QA reference: QA item 15. There is no general manual journal entry. Owner capital is available only through Loans & Equity.
- Module: Manual journals
- Description: The report says the owner could not post a general journal, and capital entry is limited to Loans & Equity.
- Severity: Not rated (QA class: blocking)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. This is a product gap unless a capital entry posted to the wrong account.
- Potential tenant impact: Service owners who need a manual journal. A shared journal screen would also affect other workspaces.
- Financial or security impact: None confirmed. QA item 17 says the dashboard labelled a 5,000 owner contribution as an expense. That label is UI-002, not proof the journal debited expense.
- Affected code paths: Not identified. Manual journals are shared ledger writes. Do not authorize a journal screen in this programme.
- Dependencies: UI-002. Package G. Product decision. Architectural review before any shared journal UI.
- Proposed remediation: No implementation until the owner decides whether Service gets a manual journal.
- Required tests: None until that decision names the accounts and the approval rule.
- Acceptance criteria: The owner accepts Loans & Equity as the only capital path, or specifies the manual journal rules.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### QA-001

- Tracking ID: QA-001
- Original QA reference: Former bucket for QA items 13, 14, and 16–28, created when the report file was missing.
- Module: Index
- Description: This ID is not a separate defect. The source text is now preserved. The items are DOC-002, DOC-003, UI-001 through UI-011, FIN-007, and TAX-005. QA item 15 is DOC-004. Do not implement QA-001 as one change.
- Severity: Not rated
- Evidence and source: File search on 10 and 11 October 2026 did not find a pre-existing `finza-demo-qa-report.md`. The owner supplied the text on 11 October 2026.
- Reproduction status: The source is available. The individual items are not reproduced.
- Root cause: Not applicable. This entry is an index.
- Potential tenant impact: None beyond the itemized IDs.
- Financial or security impact: None beyond the itemized IDs.
- Affected code paths: None.
- Dependencies: The itemized IDs.
- Proposed remediation: Do not schedule QA-001. Work the itemized IDs.
- Required tests: None on this ID.
- Acceptance criteria: Each itemized ID keeps its own QA reference. This ID stays an index.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

## UI — Interface and user experience

### UI-001

- Tracking ID: UI-001
- Original QA reference: QA item 16. Dashboard figures stay stale until Refresh, and the label says "Based on ledger records".
- Module: Dashboard
- Description: The report says the dashboard does not show current ledger figures until a manual refresh.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service dashboard users.
- Financial or security impact: Decisions can use stale figures. Not confirmed. FIN-003 is snapshot staleness, which may or may not be this screen.
- Affected code paths: Not identified.
- Dependencies: FIN-003. Package G.
- Proposed remediation: Package G. Name the dashboard query before changing it.
- Required tests: After a posted journal, the dashboard matches the ledger without requiring a second unexplained refresh, or it says the figures are cached.
- Acceptance criteria: The label and the refresh behavior match the data source.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-002

- Tracking ID: UI-002
- Original QA reference: QA item 17. The dashboard lists the 5,000 owner contribution as "Expense recorded".
- Module: Dashboard
- Description: The report says an owner contribution of 5,000 was labelled as an expense. It does not say the ledger debited an expense account.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: The QA dashboard.
- Financial or security impact: The activity label can be wrong. Not confirmed as a profit-and-loss expense.
- Affected code paths: Not identified.
- Dependencies: DOC-004. Package G.
- Proposed remediation: Package G. Read the journal for that 5,000 contribution before changing a label or a posting.
- Required tests: An owner contribution is not listed as an expense. Its journal is equity, not expense.
- Acceptance criteria: The 5,000 entry's journal is identified, and the dashboard label matches that journal.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-003

- Tracking ID: UI-003
- Original QA reference: QA item 18. Dashboard "Latest period" showed July although October was active.
- Module: Dashboard period
- Description: The report says the latest-period label was July while the active period was October.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service dashboard users.
- Financial or security impact: The reader can open the wrong period. No amount was stated.
- Affected code paths: Not identified. Period selection may be shared. Do not authorize a change.
- Dependencies: FIN-007. Package D.
- Proposed remediation: Package D. Compare the label with the open October period before editing the shared period helper.
- Required tests: When October is the active period, the dashboard does not label July as latest.
- Acceptance criteria: The label matches the period the statements use.
- Implementation status: REPORTED
- Release package: D
- Owner: unassigned

### UI-004

- Tracking ID: UI-004
- Original QA reference: QA item 19. Supplier Bills list shows Total Paid 0.00 while QA-BILL-001 has 500 paid. The residual note says QA-BILL-001 is 1,150, due 650, which is consistent with 500 paid.
- Module: Supplier bills list
- Description: The report says the list total paid does not include the 500 recorded on the bill.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified. The "what works" note says supplier bills post and overpayments are blocked. That does not clear the list total.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service supplier-bill lists.
- Financial or security impact: Paid and due on the list can disagree with the bill. Not confirmed.
- Affected code paths: Not identified.
- Dependencies: Package G.
- Proposed remediation: Package G. Compare the list aggregate with payments on QA-BILL-001 before changing the query.
- Required tests: A bill with 500 paid shows 500 in the list total.
- Acceptance criteria: List total paid equals the sum of bill payments for the listed bills.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-005

- Tracking ID: UI-005
- Original QA reference: QA item 20. The issue-invoice dialog stays on "Issuing…" after the invoice has been issued.
- Module: Issue invoice
- Description: The report says the dialog does not leave the in-progress state even though the issue succeeded.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service invoice issue.
- Financial or security impact: A second click could be attempted. Whether a second issue is possible was not tested. DOC-001 is a different double-create path.
- Affected code paths: Not identified.
- Dependencies: Package G.
- Proposed remediation: Package G. Reproduce the dialog and confirm the invoice issues once.
- Required tests: One issue request creates one issued invoice, and the dialog closes or shows success.
- Acceptance criteria: The dialog does not remain on "Issuing…" after a successful issue.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-006

- Tracking ID: UI-006
- Original QA reference: QA item 21. Customer dropdown: typing to search does nothing, and the first click is often ignored.
- Module: Customer picker
- Description: The report says search text does not filter the customer list, and the first click often does not select.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service document forms that use this dropdown.
- Financial or security impact: The wrong customer could be selected if the first click is ignored and a later click hits a different row. Not confirmed.
- Affected code paths: Not identified. Confirm the picker is not shared with Retail before any edit. Do not authorize a change.
- Dependencies: Package G.
- Proposed remediation: Package G. Reproduce on the invoice customer field.
- Required tests: Typed search filters the list. The first click selects the customer under the pointer.
- Acceptance criteria: Both reported behaviors are reproduced or recorded as not reproduced.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-007

- Tracking ID: UI-007
- Original QA reference: QA item 22. Payroll showed 0 eligible employees until reload.
- Module: Payroll employee list
- Description: The report says the eligible-employee list was empty until the page was reloaded.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service payroll runs.
- Financial or security impact: A run created from the empty list could omit employees. The report does not say a run was saved from that empty state.
- Affected code paths: Not identified.
- Dependencies: Package G. Payroll calculation stays in Package E.
- Proposed remediation: Package G. Reproduce the empty list before changing the query.
- Required tests: An employee who is eligible appears on the first load.
- Acceptance criteria: The first load lists the same eligible employees as the reload.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-008

- Tracking ID: UI-008
- Original QA reference: QA item 23. The quotes sidebar link crashed the app once.
- Module: Quotes navigation
- Description: The report says the quotes link crashed the application one time. No error text was included.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Unknown. A single crash without a stack is not a confirmed defect.
- Financial or security impact: None stated.
- Affected code paths: Not identified.
- Dependencies: Package G.
- Proposed remediation: Do not change navigation until the crash is reproduced with an error.
- Required tests: None until an error is captured.
- Acceptance criteria: The crash is reproduced with a stack, or the entry stays reported without a code change.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-009

- Tracking ID: UI-009
- Original QA reference: QA item 24. "Subtotal" means gross on the new-invoice form and pre-tax on the saved invoice.
- Module: Invoice totals
- Description: The report says the same word covers two different amounts.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service invoice entry.
- Financial or security impact: A user can misread the taxable amount. Not confirmed as a stored wrong total. The "what works" note says invoices post.
- Affected code paths: Not identified.
- Dependencies: TAX-005. Package G.
- Proposed remediation: Package G. Use one meaning on the form and the saved invoice after the two amounts are identified.
- Required tests: The label on the draft form and the saved invoice refer to the same component, and the stored total is unchanged by the label fix.
- Acceptance criteria: Both screens define subtotal the same way, and a 2,000 tax-inclusive example still totals 2,000.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

### UI-010

- Tracking ID: UI-010
- Original QA reference: QA item 25. "Issue Credit Note" is offered on an unnumbered draft invoice.
- Module: Credit note action
- Description: The report says a draft invoice that has no number still offers issue credit note.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established.
- Potential tenant impact: Service draft invoices.
- Financial or security impact: A credit note against a draft could post if the action is live. Posting was not confirmed.
- Affected code paths: Not identified.
- Dependencies: INV-003, INV-004. Package C.
- Proposed remediation: Package C. Hide or reject the action on a draft until the rule is confirmed.
- Required tests: A draft invoice cannot issue a credit note. An issued invoice can, within INV-004's limit.
- Acceptance criteria: The action is absent or rejected on an unnumbered draft, and no credit-note journal is created.
- Implementation status: REPORTED
- Release package: C
- Owner: unassigned

### UI-011

- Tracking ID: UI-011
- Original QA reference: QA item 27. Period end dates are shown as "12:00 am" on the last day.
- Module: Period dates
- Description: The report says a period end is displayed as midnight on the last day.
- Severity: Not rated (QA class: display)
- Evidence and source: QA report only. Not independently verified.
- Reproduction status: Not re-checked in this reconciliation.
- Root cause: Not established. A date stored as midnight can be correct and still look like the wrong day in another timezone. That was not checked.
- Potential tenant impact: Any screen that shows period end this way.
- Financial or security impact: A reader can think the period ends at the start of the last day. Not confirmed as a posting cutoff error.
- Affected code paths: Not identified. Shared period display. Do not authorize a change.
- Dependencies: FIN-007. Package G.
- Proposed remediation: Package G. Show the calendar date without a misleading time, after confirming the stored value.
- Required tests: A period ending 31 October is not labelled as midnight in a way that moves the day.
- Acceptance criteria: The displayed end date is the last calendar day of the period in the business timezone.
- Implementation status: REPORTED
- Release package: G
- Owner: unassigned

## INF — Build, infrastructure and CI

### INF-001

- Tracking ID: INF-001
- Original QA reference: none
- Module: Production build
- Description: `npx next build --webpack` fails Next 16 route `params` typing. The control-tower page was corrected to await `params` and still redirects to `/accounting/clients/${businessId}/overview`. The build then failed on `app/api/accounting/afs/[run_id]/finalize/route.ts`, where POST `params` is a union of `Promise` and a plain object. That sweep was stopped. The generated `.next/types` tree reported 133 errors of the same class, including routes outside Package A.
- Severity: P3
- Evidence and source: Webpack build on 11 October 2026, exit 1, after the control-tower edit. `npm run build` also failed earlier because Turbopack rejected the worktree's `node_modules` junction. That junction is an environment limit of this worktree, not a product change.
- Reproduction status: Confirmed for this worktree. The control-tower error is gone. The AFS finalize error remains. Vercel has a READY deployment of the baseline, so this local failure is not proof that the current production build is broken.
- Root cause: Installed Next.js 16.1.7 requires route `params` to be a `Promise`. Several existing routes still type `params` as a plain object, or as a union that includes a plain object.
- Potential tenant impact: None until a build that includes a failing typecheck is required.
- Financial or security impact: None.
- Affected code paths: `app/accounting/control-tower/[businessId]/page.tsx` is corrected. The remaining build error is `app/api/accounting/afs/[run_id]/finalize/route.ts`. Other generated `params` errors were not edited.
- Dependencies: Release gate 9. The control-tower typing was the authorized smallest correction. Further route edits are not part of Package A.
- Proposed remediation: Leave the remaining `params` routes for a separate build pass. Do not mass-edit them to force this package green.
- Required tests: `npx next build --webpack` completes typecheck.
- Acceptance criteria: The build failure is gone and the control-tower redirect still sends the user to the client overview.
- Implementation status: CONFIRMED
- Release package: none until scheduled. Listed under Package A only as a release-gate blocker for a local production build.
- Owner: unassigned

### INF-002

- Tracking ID: INF-002
- Original QA reference: none
- Module: Lint
- Description: ESLint 8.57.1 exited 2 before linting because the accounting override mixed an object `no-restricted-imports` pattern with the bare string `"@/!(*accounting|shared)/*"`. That string is now an object with the same glob and a message. Targeted ESLint then exited 0 with 0 errors and 3 warnings in `app/pay/[invoiceId]/page.tsx`. `npm run lint` still fails because Next.js 16.1.7 treats `lint` as a directory and does not invoke ESLint.
- Severity: P2
- Evidence and source: ESLint 8.57.1 on 11 October 2026, before and after the accounting-pattern correction. The invalid config is on HEAD and predates Package A.
- Reproduction status: The schema error is corrected. Targeted lint of the Package A files completed. The repository lint script still does not lint. The entry stays CONFIRMED.
- Root cause: The accounting override did not match the installed ESLint schema. Separately, the `lint` script calls `next lint`, which this Next.js version does not provide.
- Potential tenant impact: None directly. The release gate cannot use lint evidence.
- Financial or security impact: None.
- Affected code paths: `.eslintrc.json` accounting override only. The root rule block was not changed. Retail overrides were not changed.
- Dependencies: Package A release gate. The correction preserves the accounting glob. It does not relax Retail rules.
- Proposed remediation: The schema correction is done. A later change may point `npm run lint` at ESLint directly. That script was not changed in this pass. The three pay-page warnings were not rewritten.
- Required tests: ESLint exits 0 on the Package A file list. Met for errors. Three warnings remain.
- Acceptance criteria: The payment files are linted and the result is recorded. Targeted lint is recorded in `PACKAGE_A_ACCEPTANCE_REPORT.md`. A green `npm run lint` is still required before this entry can move.
- Implementation status: CONFIRMED
- Release package: A, as a gate, not as an authorized config edit yet
- Owner: unassigned
