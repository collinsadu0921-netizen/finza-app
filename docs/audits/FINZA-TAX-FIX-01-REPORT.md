# FINZA — Tax Defect Remediation Report

**Task:** `FINZA-TAX-FIX-01`  
**Audit source:** `docs/audits/FINZA-TAX-PROD-01.md`  
**Baseline:** `origin/main` @ `9008fe3c4faa620bb9cdcb904b6d119579db8636`  
**Branch:** `fix/finza-tax-fix-01`  
**Worktree:** isolated feature worktree; no deployment, push or merge performed  
**Report status:** Implementation complete for Stages A–E; independent review required before release

---

## 1. Executive summary

The verified defects from `FINZA-TAX-PROD-01` were reproduced on the latest
`origin/main` baseline and corrected on the dedicated branch
`fix/finza-tax-fix-01`. Five stage commits isolate the changes:

| Stage | Commit | Scope |
|---|---|---|
| A | `e1cc03830b94d0ae6cdc2a1525420d13e64f1339` | VAT return calculation, period overlap, paid-state immutability, atomic/idempotent VAT payment |
| B | `3f080060a9fcb126dedc9159355c226e64197ad3` | Effective-dated WHT rates, server-side payment WHT validation, atomic/idempotent WHT remittance |
| C | `f0e934e1f9703759f8b6ab26cf6adb8da89c2a4d` | VAT taxable bases from transaction evidence, zero-rated/exempt reporting, post-2026 inclusive helper |
| D | `660ec5ab8f5d41069197096f5d5d05a3aa0d66b2` | Supplier bill issue-date tax, persisted tax lines, pre-2026 input-levy absorption |
| E | `e2e9e5d380ad4c8f18065b21d4e8c058da6a9f36` | Tax control account fallback, opening-balance recommendation |

Two small follow-up commits strengthen coverage within Stages A and D:
`fdfa1b5` (Professional-tier VAT payment SQL coverage) and `2978f71`
(preserve the canonical ROUNDING line on account 7990).

No production database, configuration, deployment or tax record was modified.
Existing historical production test records were not deleted, reset, rewritten
or backfilled.

---

## 2. Baseline and method

- Fetched `origin/main` and verified the audited SHA was still the latest:
  `9008fe3c4faa620bb9cdcb904b6d119579db8636`.
- Read the full audit report and inspected the relevant routes, helpers,
  migrations, RPCs and tests.
- Reproduced the reported failure mechanisms with focused tests and read-only
  production queries.
- Implemented only the documented failure mechanisms.
- Added unit, route and SQL regression coverage.
- Ran the accounting CI suite and the broader Jest suites.
- SQL integration tests were run against an isolated local database seeded
  from a **schema-only** dump of the production `public` schema, with
  migrations 618–620 applied. No production data was copied.

---

## 3. Defects confirmed and root causes

| Finding | Confirmed cause |
|---|---|
| TAX-01 — VAT taxable bases from `VAT / 15%` | `calculate` and `create` derived taxable sales/purchases from output/input VAT instead of transaction evidence. Zero-rated and exempt supplies were invisible. |
| TAX-02 — calculate/create net VAT divergence | The two routes used different formulas; the create route included COVID/NHIL/GETFund in the net in ways that did not match the pre-2026 regime. |
| VAT overlap | No server or database guard prevented overlapping active return periods. |
| Paid VAT reopening | The status API and database allowed a paid return to move back to an editable state. |
| VAT payment duplicate | The payment path had no database-level idempotency identity and the legacy RPC wrote journal tables directly. |
| TAX-05 — client-controlled payment WHT | `payments/create` trusted the submitted `wht_amount` without validating it against the invoice or prior payments. |
| TAX-06 — hard-coded WHT rates | Bill/invoice routes used static current rates rather than the effective-dated `wht_rates` configuration. |
| TAX-07 — non-atomic WHT remittance | The route inserted a remittance, links, bill updates and a journal in separate calls; a journal failure left partial state. |
| TAX-04 — bill tax current date | Bill create/update called the tax engine without the issue date, so backdated bills used today's rates. |
| TAX-13 — bill tax lines absent | Bill routes never persisted `tax_lines` or engine metadata. |
| TAX-12 — pre-2026 input levies | Bill posting treated non-creditable pre-2026 NHIL/GETFund/COVID as input tax control accounts. |
| TAX-16 — post-2026 inclusive helper | `extractTaxFromInclusivePrice` divided by the 1.20 multiplier but then compounded VAT on the levies, producing 15.75 instead of 15.00 on a 100 base. |
| TAX-08 — tax control exports | `getTaxControlAccountCodes` returned `null` when the business had no explicit `VAT_PAYABLE`/levy mappings, so accountant VAT/levies exports returned 404. |
| TAX-09 — opening balances | Opening balances reject all system accounts, including 2100–2130 and 2200–2240. No production Proceed business or opening-balance batch exists today. |

---

## 4. Stage A — VAT return and payment integrity

### 4.1 Shared regime-aware calculation

Added `lib/vat/vatReturnCalculation.ts` as the single calculation source for
calculate, create and draft updates:

- Pre-2026 net VAT = output VAT − input VAT. NHIL, GETFund and COVID remain
  outside the net VAT position.
- Post-2026 (Act 1151, effective 2026-01-01) net VAT = output VAT + NHIL +
  GETFund − input VAT − NHIL − GETFund.
- COVID is reported but never included in the post-2026 net.
- Adjustments are applied consistently to net VAT and total tax.

Added `lib/vat/vatPeriod.ts` with date-only month helpers. VAT periods must be
full calendar months; this removes the previous local-timezone `toISOString()`
shift. Updated the VAT create UI and the VAT/levies/transactions export
boundaries to use the same helpers.

### 4.2 Overlap protection

- API pre-check in `app/api/vat-returns/create/route.ts`.
- Migration 618 adds `prevent_vat_return_period_overlap`, a **non-destructive**
  trigger that rejects new overlapping active periods. Existing historical
  overlaps are not validated, rewritten or deleted. Updates that do not change
  the period or deletion state are allowed.

### 4.3 Paid-state immutability

- API transition map: `draft → submitted → paid`; paid returns cannot move back.
- Migration 618 adds `prevent_invalid_vat_return_status_transition`. A paid
  transition requires a linked payment journal. Existing paid-without-journal
  rows remain readable and are surfaced as `paid_without_payment`.
- Status changes are audited with `createAuditLog`.

### 4.4 Atomic, idempotent VAT payment

Migration 618 replaces `post_vat_return_payment_atomic` with a version that:

- locks the return and checks business access, status, date, account and period;
- reconciles the filing's tax split to the filing period's ledger movement on
  2100/2110/2120/2130;
- reuses `post_journal_entry` instead of writing journal tables directly;
- posts one balanced journal and links it to the return;
- is idempotent by `payment_journal_entry_id`;
- refuses negative/refund components and legacy paid-without-journal rows;
- posts for Professional-tier VAT tenants through a controlled internal
  system-source elevation, after the RPC's own authorization checks.

### 4.5 Stage A files

- `lib/vat/vatPeriod.ts`
- `lib/vat/vatReturnCalculation.ts`
- `app/api/vat-returns/calculate/route.ts`
- `app/api/vat-returns/create/route.ts`
- `app/api/vat-returns/[id]/route.ts`
- `app/vat-returns/create/page.tsx`
- `app/api/accounting/exports/{vat,levies,transactions}/route.ts`
- `supabase/migrations/618_vat_return_integrity.sql`
- `lib/vat/__tests__/vatPeriod.test.ts`
- `lib/vat/__tests__/vatReturnCalculation.test.ts`
- `supabase/tests/database/vat_return_integrity_618.test.sql`

### 4.6 Stage A test evidence

- 10 VAT period/calculation unit tests passed.
- SQL test passed: overlap rejection, paid reopening rejection, atomic
  payment, idempotent retry, balanced journal, Professional-tier payment.
- Existing VAT/PDF/payment suites passed.

---

## 5. Stage B — WHT security and transaction integrity

### 5.1 Effective-dated rates

Added `lib/wht/rateResolver.ts`:

- reads `wht_rates` by code and `effective_from <= transaction date`;
- current rates are used only for current dates; legacy rates only for
  historical dates;
- an inactive current rate is rejected;
- a missing/unreadable rate table falls back only to the matching static
  current or historical rate set;
- unknown codes and invalid dates return explicit errors.

Applied the resolver to supplier bills (create and draft update), customer
invoices (create and preview) and invoice WHT previews. The WHT base remains
the pre-tax document subtotal.

### 5.2 Server-side payment WHT validation

`app/api/payments/create/route.ts` now:

- fetches the invoice's stored `wht_receivable_applicable` and
  `wht_receivable_amount`;
- sums prior `wht_amount` across non-deleted payments;
- rejects WHT on non-WHT invoices, WHT above the remaining invoice withholding,
  WHT above the gross payment amount, negative/non-numeric WHT;
- keeps legitimate zero-WHT and partial payments valid;
- uses a 0.01 rounding tolerance.

### 5.3 Atomic WHT remittance

Migration 619 adds:

- `payments_wht_amount_nonnegative` and
  `payments_wht_amount_not_above_amount` checks (NOT VALID, so historical rows
  are preserved while new/updated rows are enforced);
- a unique index on `wht_remittance_bills(bill_id)`;
- `create_wht_remittance_atomic`, which locks source bills, checks business
  access/accounting authority/period, records the remittance, links and marks
  bills, posts the journal through `post_wht_remittance_to_ledger`, and returns
  an idempotent reuse result on retry;
- rejects draft/ineligible bills, partial retries, duplicate links and legacy
  remittances without a journal.

The API route now calls this one RPC and maps error codes to 400/403/409/500.
No multi-step partial state remains.

### 5.4 Stage B files

- `lib/wht.ts`
- `lib/wht/rateResolver.ts`
- `app/api/bills/create/route.ts`
- `app/api/bills/[id]/route.ts`
- `app/api/invoices/create/route.ts`
- `app/api/invoices/preview-draft/route.ts`
- `app/api/payments/create/route.ts`
- `app/api/wht/route.ts`
- `supabase/migrations/619_wht_payment_and_remittance_integrity.sql`
- resolver, payment, remittance and invoice/bill tests
- `supabase/tests/database/wht_remittance_619.test.sql`

### 5.5 Stage B test evidence

- Resolver tests: current/legacy dates, inactive current rates, historical
  inactive rates, invalid dates/categories.
- Payment WHT tests: non-WHT invoice, remaining withholding, WHT above gross,
  partial/exact/zero WHT, negative/non-numeric WHT.
- WHT remittance route tests: RPC call, idempotent retry, 409/403/400/500
  mapping, fail-closed missing journal.
- SQL test passed: Professional-tier atomic remittance, balanced journal,
  retry reuse, duplicate link rejection, draft/unknown bill rejection, payment
  WHT check.
- Existing `supplier_bill_wht_2150` and `wht_payable_589` SQL tests passed.

---

## 6. Stage C — VAT calculation accuracy

### 6.1 Post-2026 inclusive helper

`lib/vat.ts` now applies the simplified regime correctly:

- `extractTaxFromInclusivePrice`: post-2026 VAT base = pre-tax base; pre-2026
  VAT remains compounded on NHIL/GETFund/COVID.
- `calculateCartTaxes` exclusive mode uses the same regime rule.
- Pre-2026 retail still excludes COVID from pricing; that existing retail
  policy was preserved and documented in tests.

The previously failing `lib/__tests__/ghana-tax-consistency.test.ts` now passes
without changing its expectation.

### 6.2 Taxable bases from transaction evidence

Migration 620 adds:

- `total_zero_rated_sales`, `total_exempt_sales`,
  `total_zero_rated_purchases`, `total_exempt_purchases` to `vat_returns`;
- `extract_tax_line_base`, which reads persisted tax-line bases from canonical
  invoice `{lines: [...]}` and retail `{tax_lines: [...]}` documents;
- `extract_vat_taxable_bases`, a read-only function that:
  - sums standard-rated invoice, bill and expense bases;
  - sums retail standard-rated tax-line bases;
  - subtracts applied customer credit notes;
  - classifies retail zero-rated/exempt supplies from product categories;
  - reconciles total sales to ledger revenue credits;
  - returns explicit warnings for unclassified/fallback documents.

The shared calculator no longer derives taxable bases from VAT / 15%. It
requires explicit bases and reports `taxable_bases_source: "unavailable"` when
evidence is missing. The calculate route returns a structured
`data_quality_exception`; the create route blocks with 409 when output VAT has
no standard-rated sales base or input VAT has no purchase base.

`total_taxable_sales`/`total_taxable_purchases` now include zero-rated taxable
supplies and exclude exempt supplies, matching the audit's Box 2/9 concern.
The create/view UIs show the classified bases and warnings. The VAT 3 PDF shows
a supplemental zero-rated/exempt classification block.

### 6.3 Stage C files

- `lib/vat.ts`
- `lib/vat/vatReturnCalculation.ts`
- `lib/vat/taxableBases.ts`
- `app/api/vat-returns/calculate/route.ts`
- `app/api/vat-returns/create/route.ts`
- `app/api/vat-returns/[id]/route.ts`
- `app/api/vat-returns/[id]/export/pdf/route.ts`
- `app/vat-returns/create/page.tsx`
- `app/vat-returns/[id]/page.tsx`
- `supabase/migrations/620_vat_taxable_bases.sql`
- unit/route/PDF tests and `vat_taxable_bases_620.test.sql`

### 6.4 Stage C test evidence

- `ghana-tax-consistency.test.ts` passes (previously the known baseline failure).
- New retail inclusive/exclusive tests pass for 2025 and 2026.
- Taxable-base normalization and data-quality tests pass.
- Calculate/create route tests pass for standard, zero-rated, exempt and
  unreconciled periods.
- PDF supplemental classification test passes.
- SQL test passed: standard/zero/exempt retail, invoices, credit notes, bills,
  expenses, ledger revenue reconciliation, unclassified warnings, and no
  VAT/15% derivation in an empty period.

---

## 7. Stage D — Supplier bill tax corrections

### 7.1 Issue-date tax

Bill create and draft update now pass the bill `issue_date` to the canonical
Ghana tax engine. Backdated 2025 bills use the 2025 regime; 2026 bills use Act
1151. The canonical reverse calculation was corrected for purchases: tax lines
are debits (or absorbed cost lines), so the pre-tax base is now derived
correctly instead of returning the gross total.

### 7.2 Persisted tax evidence

Added `lib/bills/billTaxLines.ts` to store:

- `tax_lines` with code, name, rate, base, amount, ledger account/side,
  `is_creditable_input` and `absorbed_to_cost`;
- `subtotal_excl_tax`, `tax_total`, `total_incl_tax`;
- engine metadata (`meta`, `pricing_mode`).

Bills now persist `tax_lines`, `tax_engine_code`, `tax_engine_effective_from`
and `tax_jurisdiction` on create and draft edit. Existing bills are not
backfilled.

### 7.3 Input-tax treatment

- Post-2026 VAT/NHIL/GETFund post to input-tax control accounts 2100/2110/2120.
- Pre-2026 VAT posts to 2100.
- Pre-2026 non-creditable NHIL/GETFund/COVID are pointed at the absorption
  account: inventory 1450 for material bills, expense 5200 otherwise. They are
  not posted to 2110/2120/2130 and are not claimed as input tax.
- The existing bill posting function consumes the persisted `tax_lines`; no
  journal-table writes or ledger-contract changes were introduced.
- WHT continues to credit 2150 and reduce AP.

### 7.4 Stage D files

- `lib/taxEngine/jurisdictions/ghana.ts`
- `lib/bills/billTaxLines.ts`
- `app/api/bills/create/route.ts`
- `app/api/bills/[id]/route.ts`
- `app/api/bills/__tests__/supplier-persistence.test.ts`
- `lib/bills/__tests__/billTaxLines.test.ts`
- `supabase/tests/database/bill_tax_lines_effective_date.test.sql`

### 7.5 Stage D test evidence

- 70 bills/library tests passed.
- Route tests cover 2025-12-31, 2026-01-01, foreign-currency bills and draft
  edits; they assert tax lines, rates, effective date and absorption accounts.
- SQL test passed:
  - pre-2026: Dr 5200 106, Dr 2100 15.9, Cr AP 121.9; no 2110/2120/2130 lines;
  - post-2026: Dr 5200 100, Dr 2100 15, Dr 2110 2.5, Dr 2120 2.5,
    Cr AP 112.5, Cr WHT 7.5; balanced.

---

## 8. Stage E — Tax configuration and opening balances

### 8.1 TAX-08 — Tax control mappings

`lib/accounting/taxControlAccounts.ts` now:

- honours explicit `chart_of_accounts_control_map` rows;
- falls back to the standard 2100/2110/2120/2130 accounts only when no
  explicit mapping exists;
- does not silently replace an explicit but inactive mapping;
- keeps every lookup scoped to the requested business;
- leaves posted journal account IDs unchanged.

This restores accountant VAT/levies exports for businesses that never had
explicit control-map rows, **provided the standard 2100–2130 accounts exist
and are active**. It does not create missing accounts or rewrite production
configuration. Unit tests cover fallback, explicit overrides, inactive
mappings, tenant isolation and query failures.

### 8.2 TAX-09 — Opening balances

The global opening-balance eligibility rules still reject system accounts,
including 2100–2130 and 2200–2240. No production Proceed business or
opening-balance batch exists today. A separate recommendation is documented in
`docs/audits/FINZA-TAX-FIX-01-OPENING-BALANCES.md`. No cutover workflow was
implemented and no restriction was relaxed.

---

## 9. Database migrations

### 9.1 Migration 618 — VAT return integrity

- `prevent_vat_return_period_overlap` trigger (INSERT/period/deletion changes).
- `prevent_invalid_vat_return_status_transition` trigger.
- Replacement `post_vat_return_payment_atomic`.
- No table or historical row rewrite.

### 9.2 Migration 619 — WHT payment and remittance integrity

- `payments.wht_amount` bounds (NOT VALID; new/updated rows enforced).
- Unique `wht_remittance_bills(bill_id)` index.
- `create_wht_remittance_atomic` RPC.
- No historical remittance, bill or payment rewrite.

### 9.3 Migration 620 — VAT taxable bases

- Four additive `vat_returns` columns.
- `extract_tax_line_base(JSONB)`.
- `extract_vat_taxable_bases(UUID, DATE, DATE)`.
- Read-only extraction; no document or ledger rewrite.

No migration was required for Stage D or the Stage E resolver fallback.

---

## 10. Test and CI evidence

### 10.1 Type checking

`npx tsc --noEmit` completed with no errors after the final changes.

### 10.2 Focused Jest suites

The final focused regression run covered VAT, WHT, tax engine, bills, invoices,
payments, tax control mappings and opening-balance eligibility:

- 51 suites passed, 3 tests skipped, **397 tests passed**.

The full repository Jest run is recorded in section 10.5.

### 10.3 SQL integration tests

Run against an isolated local database seeded from a schema-only production
`public` dump, with migrations 618–620 applied:

| Test | Result |
|---|---|
| `vat_return_integrity_618.test.sql` | PASS |
| `wht_remittance_619.test.sql` | PASS |
| `vat_taxable_bases_620.test.sql` | PASS |
| `bill_tax_lines_effective_date.test.sql` | PASS |
| `supplier_bill_wht_2150.test.sql` | PASS |
| `wht_payable_589.test.sql` | PASS |
| `ghana_tax_profile_v3_approval.test.sql` | PASS |
| `ghana_v3_tax_base_validation.test.sql` | PASS |

### 10.4 Accounting CI

`npm run ci:accounting` passed:

- accounting invariant audit: PASS (1 period audited, 1 passed);
- report-bypass scan: PASS (22 report routes compliant);
- non-ledger report scan: PASS (no violations).

The audit was run against a local PostgREST instance over the isolated
production-schema clone, not against production.

### 10.5 Full Jest suite

`npx jest --runInBand` completed with:

- 432 of 433 suites run: 391 passed, 1 skipped, 41 failed.
- 3,215 tests: 3,053 passed, 4 skipped, 158 failed.

The 41 failing suites are outside the changed tax/VAT/WHT/bills/payments
scope. Inspected failures are pre-existing harness or unrelated baseline
issues:

- missing Supabase test environment variables (opening balances, accounting
  periods, reconciliation, period exports);
- Vitest and Playwright files executed by the Jest runner;
- unrelated pre-existing assertions (payroll country rounding,
  estimates/materials, dashboard timeline, trial-readonly UI).

No failure was found in the focused tax/accounting suites listed in 10.2.
The full-suite failures are recorded here rather than being presented as
green; they are not caused by this remediation.

---

## 11. Remaining issues and explicit non-goals

These items were intentionally **not** changed under this task:

1. **Historical production test data.** Overlapping VAT returns, legacy paid
   returns without journals, the orphan WHT remittance, anomalous WHT payments
   and the 29 bills without tax lines remain untouched. Remediation requires
   separate authorization and a reviewed data plan.
2. **TAX-09 opening balances.** Recommendation only; no cutover system was
   built and no eligibility rule was relaxed.
3. **Historical pre-2026 input levies.** New bills now absorb non-creditable
   levies correctly. Historical pre-2026 returns/ledger entries were not
   rewritten.
4. **TAX-11 submission blocking on ledger mismatch.** The VAT payment RPC
   reconciles the filing to the filing-period ledger movement. The create/
   calculate routes surface taxable-base warnings and block missing bases, but
   they do not block every ledger-revenue difference. This is a remaining
   control gap for independent review.
5. **TAX-14 adjustment payment edge cases.** The new VAT payment RPC handles
   adjustments in the payment journal and reconciles the filing net. The
   historical adjustment cases were not re-run against production data.
6. **TAX-20 invoice tax/ledger date.** Invoice creation still uses the invoice
   effective-date policy for tax calculation and the ledger posting date for
   posting. This was not changed because it is outside the Stage D bill scope.
7. **WHT threshold policy (TAX-18).** The existing informational threshold was
   preserved; no statutory aggregation policy was invented.
8. **Missing tax accounts.** The Stage E fallback supplies the standard control
   codes when the accounts exist and are active. Tenants that do not have the
   actual 2100–2130 accounts still need a reviewed account-provisioning repair;
   no production account was created or modified under this task.
9. **Petroleum Compliance.** Not developed.

---

## 12. Production migration risks

| Risk | Assessment / mitigation |
|---|---|
| 618 overlap trigger | Non-destructive: existing overlaps are not validated. New overlapping periods are rejected. The trigger allows notes/status updates that do not change the period. |
| 618 status trigger | Only fires on status changes/inserts. Existing paid rows without journals remain readable. Paid transitions require a linked journal. |
| 618 payment RPC | Uses `post_journal_entry`; locks the return; reconciles filing to ledger movement; idempotent by journal. Professional-tier posting uses a scoped internal system-source elevation that is restored in an exception-safe block. Tested with a Professional-tier tenant. |
| 619 payment checks | Added `NOT VALID` so historical rows cannot block the migration; new/updated rows are enforced. |
| 619 unique bill link | Production snapshot had no duplicate `wht_remittance_bills.bill_id` rows. If another environment has duplicates, the index creation will fail; run the pre-check before applying. |
| 619 remittance RPC | One transaction for remittance, links, bill updates and journal. Role elevation is scoped and restored. Legacy remittances without journals fail closed. |
| 620 columns | Additive with defaults; existing returns keep their values. |
| 620 extractor | Read-only, business-scoped. If RLS prevents a user from reading transaction tables, the extractor returns warnings/zeros and the create route blocks instead of filing an invented base. Review RLS for any tenant where the extractor is empty unexpectedly. |
| Existing production data | No backfill or rewrite is included. Historical tax records remain unchanged. |

---

## 13. Rollback approach

Each stage is a separate commit on `fix/finza-tax-fix-01`. Roll back in reverse
order:

1. `e2e9e5d` — restore the previous tax control resolver.
2. `660ec5a` — restore bill routes and the canonical reverse calculation.
3. `f0e934e` — restore VAT base/helper code; migration 620 is additive and can
   remain applied safely, or be reverted with the reviewed down-migration.
4. `3f08006` — restore WHT routes/resolver; migration 619 checks are NOT VALID
   and the RPC/index can be dropped with the reviewed down-migration.
5. `e1cc038` — restore VAT routes/helpers; migration 618 triggers/RPC can be
   dropped with the reviewed down-migration.

Migrations 618–620 do not delete or rewrite existing rows. A rollback that
leaves the migrations applied is safe for historical data; dropping them
requires a reviewed script and should not run automatically.

---

## 14. Unresolved regulatory questions

1. **GRA VAT 3 Box 2/9 treatment of zero-rated supplies.** This implementation
   includes zero-rated taxable supplies in `total_taxable_sales`/`purchases`
   and excludes exempt supplies, following the audit's reproduction. Confirm
   against the current GRA VAT 3 form instructions before filing.
2. **Exempt/zero-rated invoice and bill classification.** Retail supplies are
   classified from product categories. Invoice/bill documents have no
   line-level VAT classification; the extractor warns instead of guessing.
   A future document-classification field is required for full coverage.
3. **Pre-2026 non-creditable levy absorption account.** Material bills absorb
   into inventory 1450; other bills into expense 5200. Confirm the preferred
   cost account with the accountant for each tenant.
4. **WHT resident-contract annual threshold.** The existing informational
   threshold was preserved; no annual aggregation or enforcement was added.
5. **Opening tax liabilities for Proceed Investments.** Confirm the actual
   cutover liabilities and evidence before authorizing the separate workflow.

---

## 15. Release-readiness assessment

**Status: ready for independent review; not ready for production deployment
without that review and separate authorization.**

The verified P0/P1 defects in the task scope are corrected and covered by
unit, route and SQL regression tests. The changes preserve the ledger posting
architecture, use the canonical tax engine and posting RPCs, keep historical
records immutable, and add explicit data-quality failures instead of invented
figures.

Before deployment:

1. Review migrations 618–620 against the target production schema and run the
   duplicate-bill-link pre-check for migration 619.
2. Run the SQL tests against a staging clone of the target database.
3. Confirm the GRA Box 2/9 and pre-2026 absorption-account questions with the
   accountant.
4. Decide separately whether to remediate historical production test data.
5. Obtain explicit authorization for production migration and deployment.

No merge, push, deployment, production migration or production data change was
performed.
