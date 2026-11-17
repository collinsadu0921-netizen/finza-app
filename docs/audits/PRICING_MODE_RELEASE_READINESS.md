# Pricing Mode — Release Readiness (Consolidated)

**Feature:** tax-inclusive vs tax-exclusive pricing for invoices, supplier bills, expenses (retail + service).
**Status:** implementation + local verification complete. **Not pushed, not deployed, no remote migration.**
**Branch/commits:** `feat/tax-pricing-mode-invoices` (local only) — `0c1562e`, `5c4a453`, `320a1de`, `6e55749`, `65f1cab`, `905f8d2`, `d096271`.

## 1. Completed checks & actual results

| Check | Method | Result |
|---|---|---|
| Engine fix (GH respects `taxInclusive`) | Jest `pricingMode.test.ts` | ✅ exclusive 70k → net 70k + NHIL 1,750 + GETFund 1,750 + VAT 10,500 = 84k; inclusive 84k → identical |
| Server-authoritative expense tax | Jest `computeExpenseTax.test.ts` | ✅ exclusive/inclusive/taxes-off/pre-2026-compound/mode-switch/self-consistent-rounding (8 cases) |
| Rounding invariants (varied amounts, both regimes) | Jest `computeExpenseTax.invariants.test.ts` | ✅ 76/76 — small/fractional/70,000/70,001, inclusive+exclusive, post/pre-2026 |
| Regression suites | Jest (tax engine + bills + expenses + GH) | ✅ **197/197 pass** |
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

## 4. Verification method (clarified) — API vs browser

**Important clarification:** the "API/database" verification did **not** execute the actual Next.js
route handlers (`app/api/invoices/create/route.ts`, `app/api/bills/...`, `app/api/expenses/...`). Those
require the running Next.js app plus a live Supabase SDK backend (PostgREST + Auth), which is not available
locally. What was actually exercised:

1. **Unit tests (Jest)** called the real helper functions directly:
   `computeExpenseTax`, `getCanonicalTaxResultFromLineItems`, `calculateTaxes`, `toTaxLinesJsonb`.
2. **Integration scripts** wrote directly to a disposable local PostgreSQL (via `pg`/`psql`), seeding the
   same persisted columns the route handlers would write (`subtotal`/`amount`, tax columns, `total`,
   `tax_lines`, `tax_pricing_mode`), then ran the real database **posting functions and triggers**
   (`post_invoice_to_ledger`, `post_bill_to_ledger`, `post_expense_to_ledger` + their `trigger_auto_post_*`).

So the calculation, persistence, and ledger posting are verified end-to-end at the code + database layer,
but the route-handler layer (auth, authority checks, request validation, and their exact orchestration) is
**code-reviewed only, not executed**.

- **API/DB verified:** tax computation, mode persistence round-trip, ledger posting, idempotency, balance, mode-switch semantics.
- **Route handlers NOT executed:** auth/authority/validation orchestration.
- **Browser NOT verified:** no running app. Manual UI checklist in §6.

## 4a. Concrete one-cent rounding issue (found and fixed)

**Before the fix**, `computeExpenseTax(70,000, true, "inclusive")` returned:

| Field | Value |
|---|---|
| Net base (`amount`) | 58,333.34 |
| NHIL | 1,458.33 |
| GETFund | 1,458.33 |
| VAT | 8,750.00 |
| **Sum of displayed components** | **11,666.66** |
| `totalTax` (from legacy engine) | **11,666.67** ← off by 1 cent |
| Gross total (`total`) | 70,000.00 |

The legacy engine's `calculateBaseFromTotalIncludingTaxes` rounded the *unrounded* tax sum (11,666.6655 → 11,666.67),
while its individually-rounded components sum to 11,666.66. For expenses this `totalTax` field is display/classification
only (expenses have no `total_tax` column), but it disagreed with the on-screen component sum by 1 cent. A more serious
variant affected **exclusive** non-clean amounts (e.g. 70,001): the gross total (84,001.20) disagreed with base + rounded
components (84,001.21), so the posting-derived base (70,000.99) would not match the stored `amount` (70,001).

**Fix (committed `d096271`):** `computeExpenseTax` now derives `totalTax` as the exact sum of the rounded components and
`total` as `base + totalTax`, so `base + totalTax = total` always. For 70,000 inclusive this yields
`totalTax = 11,666.66`, `base = 58,333.34`, `total = 70,000.00` — consistent. Regression test added for non-clean amounts.

## 5. Remaining risks

1. **Browser UI unverified** — no running app; the UI control wiring is code-reviewed only.
2. **FX / credit / reversal** runtime flows not exercised in the local DB (FX total math is code-preserved via `computed.total`).
3. **Import-bill posting** not DB-tested (path unchanged; mode persisted `'exclusive'`).
4. **Pre-existing input-tax recoverability** (separate — §7).
5. ~~Legacy engine 1-cent rounding~~ **FIXED** — see §4a. The legacy `calculateBaseFromTotalIncludingTaxes` still rounds its `totalTax` from the unrounded sum, but `computeExpenseTax` now recomputes the total from the rounded components, so persisted/displayed/ledger amounts no longer drift.

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
- **No historical amounts are rewritten** — legacy records fall back to `'inclusive'`.

### Rollback safeguards for exclusive documents (revised)

The `tax_pricing_mode` column records whether stored prices/amounts are net or gross. **Retaining the column alone
does not protect exclusive documents if the application code is reverted** — older code ignores the column and would
re-interpret a net `unit_price`/`amount` as gross, silently understating tax and total.

**Do NOT bulk-convert or recompute existing exclusive documents.** Re-interpreting/recomputing them would rewrite
historical amounts, change their tax treatment, and potentially invalidate already-posted journals. The safe rollback is:

1. **Prefer a compatibility patch.** Keep a minimal read path that reads `tax_pricing_mode` and interprets exclusive
   documents correctly (the `computeExpenseTax` / engine logic), even while reverting the rest of the feature. This lets
   existing exclusive documents be read and edited correctly without rewriting anything.
2. **Or block edits while fixing forward.** Temporarily make documents with `tax_pricing_mode = 'exclusive'` read-only
   (a guard in the edit route, or a DB trigger raising on UPDATE when the interpreting code is absent), so older code
   cannot silently recompute those amounts incorrectly.
3. **Retain the additive columns.** Never drop `tax_pricing_mode` while any exclusive record exists — it is the only
   signal distinguishing net from gross. Only drop after confirming zero exclusive records, and only as a last resort.

**Mechanism preventing mis-editing:** the edit/save path must either (a) call the pricing-mode-aware calculation, or
(b) be gated so exclusive records are read-only until (a) is restored. No historical amount, tax line, or journal is
touched by any rollback path.
