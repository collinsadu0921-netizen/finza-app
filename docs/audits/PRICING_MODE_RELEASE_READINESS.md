# Pricing Mode — Release Readiness (Consolidated)

**Feature:** tax-inclusive vs tax-exclusive pricing for invoices, supplier bills, expenses (retail + service).
**Status:** implementation + local verification complete. **Not pushed, not deployed, no remote migration.**
**Branches/commits:** `feat/tax-pricing-mode-invoices` (local only) — `0c1562e`, `5c4a453`, `320a1de`, `6e55749`, `65f1cab`, `905f8d2`.

## 1. Completed checks & actual results

| Check | Method | Result |
|---|---|---|
| Engine fix (GH respects `taxInclusive`) | Jest `pricingMode.test.ts` | ✅ exclusive 70k → net 70k + NHIL 1,750 + GETFund 1,750 + VAT 10,500 = 84k; inclusive 84k → identical |
| Server-authoritative expense tax | Jest `computeExpenseTax.test.ts` | ✅ exclusive/inclusive/taxes-off/pre-2026-compound/mode-switch (7 cases) |
| Regression suites | Jest (tax engine + bills + expenses + GH) | ✅ **120/120 pass** |
| Type check | `tsc --noEmit` | ✅ 0 errors |
| Migration 628 (invoices) | applied to staging earlier + local | ✅ column + CHECK verified |
| Migration 629 (bills/expenses) | applied to local Docker Postgres | ✅ column + CHECK verified on all three tables |
| **Ledger posting (real triggers)** | local Docker Postgres (staging schema clone) | ✅ see §2 |
| **Round-trip create→reload→edit→save** | local Docker Postgres | ✅ see §3 |

## 2. Ledger evidence (real `post_*_to_ledger` triggers)

Net GH₵70,000 ⇄ gross GH₵84,000 (post-2026, 20% flat). Exclusive and inclusive documents persist identical `subtotal`/`total`/tax and produce **byte-identical, balanced journals**:

- **Invoice:** Dr AR 84,000 / Cr Revenue 70,000 / Cr VAT 10,500 / Cr NHIL 1,750 / Cr GETFund 1,750.
- **Bill:** Dr Supplier Bills 70,000 + Dr VAT 10,500 + Dr NHIL 1,750 + Dr GETFund 1,750 / Cr AP 84,000.
- **Expense:** Dr Operating 70,000 + Dr VAT 10,500 + Dr NHIL 1,750 + Dr GETFund 1,750 / Cr Cash 84,000.

Invariants confirmed: draft → no journal; re-post reuses the entry (no duplicate); posted/sent documents are immutable.

## 3. Round-trip evidence (create → save → reload → edit → save)

For invoices, bills and expenses (mode persisted through INSERT → SELECT → UPDATE):
- **Create exclusive, entered 70,000** → stored `mode=exclusive`, net 70,000, tax 14,000, gross 84,000.
- **Edit (switch to inclusive, entered 70,000 preserved)** → stored `mode=inclusive`, net 58,333.34, gross 70,000 (tax reinterpreted; entered price unchanged).

This is **API/database-level** verification. The full browser UI was **not** exercised (see §5).

## 4. API vs browser verification

- **API/DB verified:** server tax computation, mode persistence round-trip, ledger posting, idempotency, balance, mode-switch semantics.
- **Browser NOT verified:** actual Next.js UI (no local Supabase/PostgREST stack available). Manual UI checklist in §6.

## 5. Remaining risks

1. **Browser UI unverified** — no running app; the UI control wiring is code-reviewed only.
2. **FX / credit / reversal** runtime flows not exercised in the local DB (FX total math is code-preserved via `computed.total`).
3. **Import-bill posting** not DB-tested (path unchanged; mode persisted `'exclusive'`).
4. **Pre-existing input-tax recoverability** (separate — §7).
5. Legacy engine 1-cent rounding nuance: `calculateBaseFromTotalIncludingTaxes` rounds `taxBreakdown.totalTax` (unrounded sum) slightly differently from the sum of its individually-rounded components; persisted expense columns stay consistent (`amount + nhil + getfund + vat = total`), so posting balances.

## 6. Manual UI checklist (browser, pending)

1. New invoice → "Apply taxes" ON → "Prices exclude tax" → enter 70,000 → expect "Amount before taxes 70,000", NHIL 1,750, GETFund 1,750, VAT 10,500, Total 84,000.
2. Switch to "include tax" with 84,000 → expect the same breakdown.
3. Save → reopen → confirm mode + amounts persisted; edit and confirm immutability after issuing.
4. Repeat for a standard bill and an expense (default **inclusive** for both).
5. Import bill → confirm no pricing toggle and forward tax calculation.
6. Legacy invoice (pre-feature) → confirm it opens as inclusive and amounts are unchanged.

## 7. Historical input-tax issue (tracked separately, unchanged)

Pre-2026 supplier bills/expenses post NHIL/GETFund/COVID as **recoverable** input tax (debit 2100/2110/2120) even though the engine marks them non-creditable (`absorbed_to_cost`). This understates cost/asset and overstates recoverable input tax for pre-2026 purchases. Not introduced or changed by this feature; requires a separate accounting decision.

## 8. Migration order & rollback

- **Order:** apply `628_invoice_tax_pricing_mode.sql`, then `629_bill_expense_tax_pricing_mode.sql` (both additive; 628 already on staging).
- **Rollback (code first):** revert app commits, **retain** the `tax_pricing_mode` columns. Dropping them after exclusive documents exist destroys the information needed to interpret/edit those amounts; only drop after confirming zero exclusive records and as a last resort.
- **No historical amounts are rewritten** — legacy records fall back to `'inclusive'`.
