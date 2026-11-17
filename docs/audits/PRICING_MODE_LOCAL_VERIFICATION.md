# Pricing Mode — Local Integration Verification

**Scope:** invoices, standard supplier bills, expenses (retail + service, shared code paths).
**Date:** 2026-11-17 · **Mode:** local only (disposable Docker Postgres), no push/deploy/remote migration.

## Environment

- Staging schema (structure only, **no data**) extracted read-only from the verified staging project
  `adonhhtooawkeemdqqeo` via `pg_dump --schema-only --no-owner --no-privileges` (schemas `public`, `auth`,
  `extensions`, `supabase_migrations`). Production (`qjxhibvbmzogyzbhswjj`) was never touched.
- Restored into a disposable `postgres:16-alpine` Docker container (`finza-verify`, port 55439), with
  `pgcrypto` + `uuid-ossp` extensions, then removed after the run.
- Migration state in the snapshot: `628` present (`invoices.tax_pricing_mode` exists); `629` absent
  (bills/expenses). Migration `629` was applied locally and verified (column + CHECK constraint on all three tables).

## Actual ledger posting evidence (real triggers/functions)

Post-2026 config: NHIL 2.5% + GETFund 2.5% + VAT 15% = 20% flat. Net GH₵70,000 ⇄ Gross GH₵84,000.

### Invoice (Dr AR / Cr Revenue + output tax)
| Entry | Exclusive 70,000 | Inclusive 84,000 |
|---|---|---|
| Dr 1100 Accounts Receivable | 84,000.00 | 84,000.00 |
| Cr 4000 Service Revenue | 70,000.00 | 70,000.00 |
| Cr 2100 VAT | 10,500.00 | 10,500.00 |
| Cr 2110 NHIL | 1,750.00 | 1,750.00 |
| Cr 2120 GETFund | 1,750.00 | 1,750.00 |
| **Totals** | **84,000 = 84,000** ✅ | **84,000 = 84,000** ✅ |

### Standard bill (Dr expense + input tax / Cr AP)
| Entry | Exclusive 70,000 | Inclusive 84,000 |
|---|---|---|
| Dr 5200 Supplier Bills | 70,000.00 | 70,000.00 |
| Dr 2100 VAT | 10,500.00 | 10,500.00 |
| Dr 2110 NHIL | 1,750.00 | 1,750.00 |
| Dr 2120 GETFund | 1,750.00 | 1,750.00 |
| Cr 2000 Accounts Payable | 84,000.00 | 84,000.00 |

### Expense (Dr expense + input tax / Cr Cash)
| Entry | Exclusive 70,000 | Inclusive 84,000 |
|---|---|---|
| Dr 5100 Operating Expenses | 70,000.00 | 70,000.00 |
| Dr 2100/2110/2120 input tax | 10,500 / 1,750 / 1,750 | 10,500 / 1,750 / 1,750 |
| Cr 1010 Bank (CASH) | 84,000.00 | 84,000.00 |

### Confirmed invariants
- **Parity:** exclusive and inclusive documents with equivalent net/gross persist identical `subtotal`/`total`/tax and produce **byte-identical journals** (verified for all three document types).
- **Draft does not post** (invoice/bill status `draft` → 0 journal lines).
- **Duplicate-post prevention:** re-invoking `post_*_to_ledger` reuses the existing journal (line count unchanged).
- **Balanced journals** in every case.
- **Migration round-trip:** re-editing a posted/sent document is blocked by the existing immutability guards (`sent_at` immutability, `canEditInvoice`), confirming posted-document restrictions are preserved.

## Unit-level regression tests (committed)
- `lib/taxEngine/__tests__/pricingMode.test.ts` — engine inclusive/exclusive parity (GH), pre-2026 compound, discount-before-tax.
- `lib/expenses/__tests__/computeExpenseTax.test.ts` — server-authoritative expense computation (exclusive/inclusive/taxes-off/pre-2026).
- Full tax/engine/bill/expense Jest suites: **119/119 pass**; `tsc --noEmit`: **0 errors**.

## Findings
- **No feature defects** were required to fix beyond the import-bill mode persistence already committed (`6e55749`).
- **Pre-existing, tracked separately (not changed):** bill/expense posting treats all input tax as recoverable
  (debits `2100/2110/2120`); the engine's `is_creditable_input`/`absorbed_to_cost` metadata is not consumed by
  bill/expense posting. Pre-2026 non-creditable NHIL/GETFund/COVID are posted as recoverable rather than absorbed
  into cost. Unchanged by this feature.
- **Import bills:** calculation path unchanged (always forward/exclusive); `tax_pricing_mode` persisted as `'exclusive'`.

## Remaining gaps (not run)
- Browser round-trip (create → reload → edit → save) — requires the running Next.js app; not exercised.
- Import-bill full DB posting — unchanged path, verified by code review only.
- FX/credit/reversal runtime flows — not exercised in this local DB run.

## Reproduction
`scripts/test-invoice-posting.mjs` and `scripts/test-bill-expense-posting.mjs` seed synthetic data and run the
real triggers against a local `localhost:55439` Postgres (disposable container, password `finza_test_only`).
