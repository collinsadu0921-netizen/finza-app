# FINZA — TAX REMEDIATION STABILIZATION REPORT

**Task ID:** FINZA-TAX-FIX-02
**Branch:** `fix/finza-tax-fix-01`
**Starting SHA:** `80ae1717a96bd452c5d8cd07089685b8455e7220`
**Ending implementation SHA:** `89a57afc2ff89cc83779e1fd9ad2d9c6df2c5a7b` (tax corrections and tests; documentation commit follows)
**Original production baseline:** `9008fe3c4faa620bb9cdcb904b6d119579db8636`
**Review reference:** `FINZA-TAX-REVIEW-01.md`
**Report status:** Implementation and verification complete on the existing branch. No merge, push, deployment, production migration or production data change was performed.

---

## 1. Summary

The existing tax remediation was stabilized on `fix/finza-tax-fix-01`. The work addressed
the verified review findings F-02 through F-19 (except F-17, which was hardened as
defense-in-depth), preserved the existing 618–620 corrections and ledger architecture, and
produced a separate F-01 security plan. All new migrations are additive and were applied
successfully to:

1. an isolated production-schema clone, and
2. an isolated clone loaded with the production tax data (304 invoices, 33 bills, 22 credit
   notes, 185 expenses, 12 VAT returns, 1,004 journal entries, 3,606 journal lines).

Focused Jest suites, TypeScript checks, nine SQL integration tests and a two-session
concurrency test pass. The production accounting-invariant audit still fails on existing
production test data for reasons unrelated to this branch (see §9). Playwright E2E was not
executed because no authenticated server/credentials were available.

---

## 2. Findings addressed

| Finding | Status | Evidence |
|---|---|---|
| F-02 — FX VAT bases | **Fixed and verified** | FX-aware extractor; USD/EUR/GBP/GHS SQL test; FX credit-note posting and extraction; ledger reconciliation |
| F-03 — Existing VAT overlap protection | **Fixed and verified** | Overlap re-checked on submit/pay; legacy overlapping rows blocked; SQL test |
| F-04 — Zero-rated/exempt classification | **Fixed and verified** | Document classification columns, conservative backfill, unclassified/fallback/conflict counts, hard submission blocking; SQL + Jest tests |
| F-05 — Tax transaction authorization | **Fixed and verified** | Shared DB write guard on VAT payment and WHT remittance; anonymous/non-member/read-only/service-role/owner tests |
| F-06 — Concurrent VAT period overlap | **Fixed and verified** | Per-business advisory lock + status overlap checks; two-session concurrency test |
| F-07 — Client-controlled VAT submissions | **Fixed and verified** | Draft update/submission recomputes from ledger + taxable bases; forged totals ignored; route test |
| F-08 — Submitted/paid VAT corrections | **Fixed and verified** | Auditable amendment table/API, payment reversal journal, mandatory reason/evidence, paid→draft still blocked; SQL test |
| F-09 — Historical WHT usability | **Fixed and verified** | WHT categories filtered by transaction date; 2025-12-31 regression test; server resolver authoritative |
| F-10 — Foreign-currency WHT remittance | **Fixed and verified** | GHS remittance with source-currency evidence, no double conversion; FX + GHS partial-selection SQL test |
| F-11 — Cumulative WHT protection | **Fixed and verified** | Invoice-row lock + cumulative entitlement trigger; partial-payment SQL test |
| F-12 — Negative NHIL/GETFund components | **Fixed and verified** | Negative component netting; balanced payment journal; SQL test |
| F-13 — VAT adjustments / debit balances | **Fixed and verified** | Adjustment reason required; adjustment reconciled through 2100; SQL test |
| F-14 — Tax date consistency | **Fixed and verified** | Invoice issue date is the legal tax date on create and draft update; date-only bill update recalculates tax; tests |
| F-15 — Historical mixed bills | **Fixed and verified** | Pre-2026 mixed material/service bills rejected on create and update; tests |
| F-16 — Tax-control account mapping | **Partially fixed** | Core VAT payment uses explicit mappings with validated liability fallback and fails closed on invalid/missing accounts. Provisioning the 29 businesses missing chart/account rows remains a separately authorized data remediation. |
| F-17 — DB period/link integrity (additional) | **Fixed and verified** | Calendar-month validation, immutable ownership, paid-journal ownership/reference checks; SQL test |
| F-18 — Retail/credit-note VAT treatment | **Fixed and verified** | Voided/pending/failed/refunded exclusion, cart-discount allocation, mixed-cart non-double-counting, tax-less credit notes; SQL test |
| F-19 — WHT rate-resolution safety | **Fixed and verified** | DB errors/malformed rates fail closed; stored WHT validated against rate/base before remittance; Jest + SQL tests |
| F-01 — Unauthenticated ledger posting | **Blocked pending authorization** | Separate plan: `docs/audits/FINZA-TAX-FIX-02-F01-SECURITY-PLAN.md` |
| F-20/F-21/F-22 | **Deferred / out of scope** | Production deployment/data remediation, pre-existing CI repair and legacy retail helper remain separate work |

---

## 3. Root causes and corrections

### F-02 — FX VAT bases
**Root cause:** The 620 extractor summed document-currency bases and ignored `fx_rate`,
`currency_code` and `home_currency_total`. Credit-note ledger posting also used
document-currency amounts.
**Correction:** Convert invoices using the recorded gross minus home-currency tax, bills and
expenses using `fx_rate`, and credit notes using the linked invoice rate. Missing/invalid
rates are explicit exceptions and block filing. Migration 626 makes credit-note posting
FX-aware.

### F-03 / F-06 — Overlap and concurrency
**Root cause:** Overlap was checked only at creation, and concurrent inserts could both pass.
Legacy overlapping rows were not re-checked at submission/payment.
**Correction:** A per-business advisory transaction lock serializes overlap decisions; the
trigger re-checks active-status overlap on insert/update; legacy overlaps cannot both be
submitted. A two-session test proves the second insert waits and then fails.

### F-04 / F-18 — Classification and retail/credit-note edges
**Root cause:** Unknown zero-tax documents were inferred as zero/exempt or ignored; retail
`voided`/pending/failed sales were included; zero/exempt retail bases ignored cart discounts;
tax-less credit notes were not deducted.
**Correction:** Explicit `vat_classification` evidence with conservative backfill; unknown
stays `unclassified`; submission is blocked on unclassified, fallback, invalid-FX and
conflict evidence. Retail extraction excludes voided/pending/failed/refunded sales, allocates
line and cart discounts, and avoids double-counting mixed carts. Tax-less credit notes fall
back to their subtotal and are classified from the linked invoice only when evidence exists.

### F-05 — Authorization
**Root cause:** VAT payment and WHT remittance paths relied on API guards; direct RPC/table
access could bypass subscription, tier, read-only and accounting-permission checks.
**Correction:** `finza_assert_accounting_write_authorized` enforces service-role bypass,
authentication, business access, write entitlement, minimum tier, owner/admin/accountant
non-readonly authority and `accounting.view`. It is called by VAT payment and WHT remittance
triggers, so direct RPC/table writes are covered.

### F-07 — Client-controlled submissions
**Root cause:** Draft VAT updates accepted client-submitted taxable bases and component
totals, allowing stale or forged values.
**Correction:** Draft updates and submissions recompute from `extract_tax_return_from_ledger`
and `extract_vat_taxable_bases`; client totals are ignored; unresolved evidence returns 409.

### F-08 — Paid/submitted corrections
**Root cause:** Paid returns were protected, but there was no auditable correction path.
**Correction:** `vat_return_amendments` links an original filing to a replacement draft with
reason/evidence. Paid filings require `reverse_vat_return_payment`, which posts a new
reversing journal and returns the filing to `submitted`. The original journal is never
modified; paid→draft remains forbidden.

### F-09 / F-19 — WHT safety
**Root cause:** Rate resolution fell back to static rates on DB errors/conflicts, and
remittance trusted stored WHT without rate/base evidence.
**Correction:** The resolver fails closed on DB errors and invalid configured rates, preserves
the static fallback only when no row exists, and rejects historical categories for current
transactions. Remittance validates stored WHT against rate × base and fails on missing
evidence. The UI filters categories by transaction date.

### F-10 / F-11 — FX and cumulative WHT
**Root cause:** Remittance stored document-currency amounts; cumulative customer-payment WHT
was not enforced atomically.
**Correction:** Remittances store GHS amounts plus `source_wht_amount`,
`source_currency_code` and `fx_rate`; cumulative payment WHT locks the invoice row and rejects
amounts above the invoice entitlement. Retries reuse the existing remittance.

### F-12 / F-13 — Payment edge cases
**Root cause:** Negative levy components were rejected, and adjustments could leave debit
balances on tax-control accounts.
**Correction:** Negative components are netted as credits; adjustments require a reason and
are reconciled through the VAT control account (2100) without inventing offset accounts.

### F-14 / F-15 — Dates and mixed bills
**Root cause:** Sent invoices used `sent_at` as the tax date; bill date-only edits did not
recalculate tax; pre-2026 mixed material/service bills posted all non-creditable tax to
inventory.
**Correction:** Invoice `issue_date` is the legal tax date on create and draft update; draft
bill date-only updates recalculate tax; mixed pre-2026 bills are rejected on create/update.

### F-16 — Tax-control mapping
**Root cause:** Core VAT payment hard-coded 2100–2130 while exports used mappings; fallback
coverage was incomplete.
**Correction:** `finza_tax_control_account_code` uses explicit mappings first, validates an
active liability account, and returns NULL (clear provisioning error) for invalid mappings.
The payment RPC uses the resolved account and includes adjustments in the 2100 movement.
Production account provisioning is not performed automatically.

---

## 4. Files and migrations changed

### Migrations (additive, 621–626)
- `supabase/migrations/621_tax_authorization_overlap_integrity.sql`
- `supabase/migrations/622_vat_taxable_bases_fx_classification.sql`
- `supabase/migrations/623_wht_fx_cumulative_integrity.sql`
- `supabase/migrations/624_vat_payment_mapping_adjustments.sql`
- `supabase/migrations/625_vat_return_amendments.sql`
- `supabase/migrations/626_credit_note_fx_posting.sql`

### Application and library code
- `app/api/bills/[id]/route.ts`
- `app/api/bills/create/route.ts`
- `app/api/credit-notes/create/route.ts`
- `app/api/expenses/create/route.ts`
- `app/api/invoices/[id]/route.ts`
- `app/api/invoices/create/route.ts`
- `app/api/vat-returns/[id]/route.ts`
- `app/api/vat-returns/[id]/amend/route.ts`
- `app/api/vat-returns/calculate/route.ts`
- `app/api/vat-returns/create/route.ts`
- `app/bills/create/page.tsx`
- `app/invoices/new/page.tsx`
- `lib/accounting/taxControlAccounts.ts`
- `lib/expenses/insertExpenseForBusiness.ts`
- `lib/tax/classification.ts`
- `lib/vat/taxableBases.ts`
- `lib/wht.ts`
- `lib/wht/rateResolver.ts`

### Tests added or updated
- `app/api/bills/__tests__/supplier-persistence.test.ts`
- `app/api/invoices/__tests__/create.test.ts`
- `app/api/invoices/__tests__/update-tax-date.test.ts`
- `app/api/vat-returns/__tests__/taxableBases.test.ts`
- `app/api/vat-returns/__tests__/update-server-authority.test.ts`
- `lib/__tests__/wht.test.ts`
- `lib/accounting/__tests__/taxControlAccounts.test.ts`
- `lib/tax/__tests__/classification.test.ts`
- `lib/vat/__tests__/taxableBases.test.ts`
- `lib/wht/__tests__/rateResolver.test.ts`
- `supabase/tests/database/tax_authorization_overlap_621.test.sql`
- `supabase/tests/database/vat_overlap_concurrency_621.test.js`
- `supabase/tests/database/vat_payment_mapping_adjustments_624.test.sql`
- `supabase/tests/database/vat_retail_classification_622.test.sql`
- `supabase/tests/database/vat_return_amendments_625.test.sql`
- `supabase/tests/database/vat_taxable_bases_fx_622.test.sql`
- `supabase/tests/database/wht_fx_cumulative_623.test.sql`
- `supabase/tests/database/vat_taxable_bases_620.test.sql`
- `supabase/tests/database/wht_remittance_619.test.sql`

---

## 5. Test results

### TypeScript
- `npx tsc --noEmit` — **pass** (no output).

### Jest (focused tax suites)
- Command: `npx jest app/api/invoices app/api/bills app/api/credit-notes app/api/expenses app/api/vat-returns lib/vat lib/wht lib/tax lib/__tests__/wht.test.ts lib/accounting/__tests__/taxControlAccounts.test.ts --runInBand`
- Result: **40 suites passed, 285 tests passed, 3 skipped, 288 total**.

### SQL integration tests
All nine tests passed on both the schema-only clone (`finza_tax_test`) and the
production-data clone (`finza_tax_data_test`):

| Test | Result |
|---|---|
| `vat_return_integrity_618.test.sql` | PASS |
| `wht_remittance_619.test.sql` | PASS (including partial payments) |
| `vat_taxable_bases_620.test.sql` | PASS |
| `tax_authorization_overlap_621.test.sql` | PASS |
| `vat_taxable_bases_fx_622.test.sql` | PASS |
| `vat_retail_classification_622.test.sql` | PASS |
| `wht_fx_cumulative_623.test.sql` | PASS (FX + GHS partial selection) |
| `vat_payment_mapping_adjustments_624.test.sql` | PASS |
| `vat_return_amendments_625.test.sql` | PASS |

### Concurrency
- `supabase/tests/database/vat_overlap_concurrency_621.test.js` — **PASS**. Two sessions
  inserted the same period; session B blocked on the advisory lock and failed with
  `VAT_RETURN_PERIOD_OVERLAP` after session A committed.

### Migration compatibility
Migrations 618–626 were applied in order to a clone containing the production tax data
without errors. Backfill results on existing data:

| Table | Standard | Unclassified |
|---|---:|---:|
| invoices | 193 | 111 |
| bills | 27 | 6 |
| credit_notes | 16 | 6 |
| expenses | 111 | 74 |

Unknown documents were not assigned to zero-rated or exempt. Periods containing unclassified
documents now block filing.

### Accounting CI
- `npm run ci:detect-bypass` — **pass** (“All report routes are compliant”).
- `npm run ci:detect-non-ledger` — **pass** (“No violations found”).
- `npm run ci:accounting-audit` — **fails on existing production test data** (3 of 3 periods
  for one business, 1 of 1 for another). Failures are pre-existing balance-sheet and
  rollforward violations in production test data, not caused by this branch; the branch
  migrations were not applied to production. This audit cannot be claimed as passing.

### Not executed
- Playwright E2E: not run (no authenticated server/credentials available).
- Full repository Jest suite: not run; the review recorded pre-existing unrelated failures.
  Only the focused tax suites above are claimed as passing.

### Failing-before evidence
The independent review reproduced F-01 through F-19 on the isolated clone. During this task,
the FX taxable-base test was observed failing at standard sales `3,100` versus the expected
`3,000` before the credit-note FX conversion was completed, then passing after migration 626
and the extractor correction. The authorization/overlap tests exercise controls that did not
exist before migration 621, and the amendment/reversal test exercises the statuses and
constraints added by migration 625. Legacy overlapping rows were simulated by disabling the
overlap trigger for fixture insertion, then re-enabling it before the submission assertion.

---

## 6. Preserved fixes

- 618 VAT period/payment integrity behavior remains covered by its SQL test.
- 619 WHT remittance validation and atomic posting remain covered; the test was extended for
  the stricter rate/base evidence and cumulative WHT.
- 620 taxable-base extraction remains covered; the test was extended for classification.
- Existing invoice/bill tax-line persistence, 7990 rounding lines, professional-tier VAT
  payment and ledger balancing were not rewritten.
- `post_journal_entry` was **not** modified; the only credit-note posting change is the
  targeted `post_credit_note_to_ledger_pkgb_body` replacement in migration 626.

## 7. New regressions

No regressions were detected in the focused suites. Intentional behavior changes:

- Sent invoices now use `issue_date` as the tax effective date (previously `sent_at`).
- WHT rate resolution now fails closed on DB errors/invalid configuration (previously used a
  static rate).
- Pre-2026 mixed material/service bills are rejected (previously posted with inaccurate
  absorption).
- Filing is blocked when classification/FX/fallback/conflict evidence is unresolved.

These changes are required by the review findings and are covered by tests.

---

## 8. Remaining unresolved findings

1. **F-01** — unauthenticated ledger posting remains a release blocker. See
   `docs/audits/FINZA-TAX-FIX-02-F01-SECURITY-PLAN.md`. It requires explicit authorization
   to modify `post_journal_entry` and revoke grants.
2. **F-16 account provisioning** — 8 active businesses are missing at least one `2100–2130`
   account and 29 are missing at least one chart tax account. The code now fails closed with a
   clear provisioning error, but production account provisioning is a separately authorized
   data remediation.
3. **F-20** — production data/deployment remediation (overlapping returns, paid returns
   without journals, orphan WHT remittance, dirty deployment) is out of scope and requires
   separate authorization.
4. **F-21** — pre-existing unrelated Jest failures and full-suite CI repair remain separate.
5. **F-22** — legacy pre-2026 retail inclusive helper remains; no production call site was
   changed.

---

## 9. Ledger and database integrity evidence

- All new migrations are additive; no posted journal or historical tax row was rewritten.
- Existing overlapping VAT returns were preserved; they cannot both be submitted or paid.
- Paid returns without payment journals are not repaired automatically; the payment RPC
  raises `VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL`.
- WHT remittances preserve historical `wht_amount`; new links store GHS and source-currency
  evidence. Historical links without source evidence remain readable.
- Credit-note postings are FX-aware and still use the canonical `post_journal_entry`.
- Amendment reversals create new journals and never modify the original payment journal.
- The production-data clone retained all existing rows and accepted migrations 618–626.
- Example extractor reconciliations on the clone:
  - `2b1ed1d7…` 2026-02: standard 1,000.00, ledger 1,000.00 — reconciled.
  - `534c1dc1…` 2026-10: standard 8,333.33, ledger 8,333.34 — 0.01 rounding.
  - `3f3c8d3a…` 2025-11/12: 65,422.54 vs ledger 75,422.54, 1 unclassified sale — blocked.
  - `4ece1510…` 2026-03: 29,374.99 vs ledger 18,125.03 — blocked pending review.

---

## 10. F-01 security correction plan

The separate plan identifies the exposed functions, current grants, trusted callers, required
authorization, revocation risks, the minimum safe migration sequence, negative security tests
and the explicit authorizations required. Summary:

- Revoke `EXECUTE` from `PUBLIC`/`anon` on all posting/reversal RPCs.
- Add an authentication/authorization guard to `post_journal_entry` only after explicit
  approval.
- Make `post_wht_remittance_to_ledger` internal-only and keep
  `create_wht_remittance_atomic` as the authorized caller.
- Audit every `SECURITY DEFINER` function that writes ledger/tax tables.
- Prove anon/non-member/read-only rejection and service-role/trigger success on a clone before
  staging.

---

## 11. Staging-readiness assessment

**Conditionally staging-ready for verification, not for untrusted exposure.**

- The branch compiles, focused Jest suites pass, SQL tests pass on both isolated clones, and
  migrations 618–626 apply cleanly to production-schema and production-data clones.
- Staging must apply migrations 618–626 in order and run the negative authorization/concurrency
  tests.
- F-01 remains an independent security blocker; staging should not be exposed to untrusted
  users until the F-01 plan is authorized and implemented.
- Playwright E2E and the full accounting audit must be completed on staging before release.

## 12. Production-readiness assessment

**Not production-ready.**

Reasons:

1. F-01 ledger-posting exposure is unresolved and is a release blocker.
2. Production tax-account provisioning for affected tenants is not performed.
3. Production data remediation (overlaps, paid-without-journal returns, orphan remittance) is
   not performed.
4. The accounting-invariant audit fails on existing production test data.
5. Playwright E2E and the full repository CI suite were not executed.
6. No production migration or deployment was authorized or performed.

The tax-specific code and migrations are ready for staging verification; production release
requires the separate F-01 authorization, data remediation approval, account provisioning and
a full staging regression run.
