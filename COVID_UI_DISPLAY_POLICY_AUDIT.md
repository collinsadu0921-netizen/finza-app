# COVID UI Display Policy – Audit

**Goal:** COVID levy must never appear anywhere in UI (including 0 rows). Zero-amount lines must not be shown. Display-only filtering; no mutation of stored `tax_lines`.

---

## 1. Repo-wide search (COVID / .covid / code === "COVID")

- **`lib/taxes/readTaxLines.ts`** – `getTaxLinesForDisplay()` filters `t.code.toUpperCase() !== "COVID"` and `Number(t.amount) !== 0`. Canonical helper for UI tax lines.
- **`components/documents/FinancialDocument.ts`** – Filters `line.code.toUpperCase() !== "COVID"` and `Number(line.amount) !== 0` on both `props.tax_lines` and `taxCalculationResult.taxLines`.
- **`app/estimates/[id]/view/page.tsx`** – Filters `code.toUpperCase() !== "COVID"` and `Number(amount) > 0` when rendering from `getTaxBreakdown(estimate.tax_lines)`.
- **`app/invoices/[id]/view/page.tsx`** – Uses `getTaxLinesForDisplay(invoice.tax_lines)`; legacy fallback builds `NHIL, GETFUND, VAT` only (no COVID) and `Number(t.amount) !== 0`.
- **`app/credit-notes/[id]/view/page.tsx`** – Uses `getTaxLinesForDisplay(creditNote.tax_lines)`.
- **`app/invoice-public/[token]/page.tsx`** – Renders only `legacyTaxAmounts.nhil`, `legacyTaxAmounts.getfund`, `legacyTaxAmounts.vat` when `> 0`. No COVID row.
- **`app/credit-public/[token]/page.tsx`** – Renders only `creditNote.nhil`, `creditNote.getfund`, `creditNote.vat` when `> 0`. No COVID row.
- **`app/reports/vat/diagnostic/page.tsx`** – Renders only NHIL, GETFund, VAT in the Tax Breakdown section. No COVID row (removed in prior pass).
- All other references to COVID / `.covid` are in: API routes (persist/read legacy columns), tax engine (calculation), tests, or backend-only paths. None render COVID in the UI.

---

## 2. Display pipelines – COVID and zero-amount filtering

| Pipeline | COVID filtered? | Zero-amount filtered? | How |
|----------|------------------|------------------------|-----|
| **lib/taxes/readTaxLines.getTaxLinesForDisplay** | Yes | Yes | `.filter((t) => Number(t.amount) !== 0 && t.code.toUpperCase() !== "COVID")` |
| **FinancialDocument (PDF/preview HTML)** | Yes | Yes | `.filter((line) => Number(line.amount) !== 0 && line.code.toUpperCase() !== "COVID")` on `props.tax_lines` and on engine result |
| **Invoice view** | Yes | Yes | `getTaxLinesForDisplay(invoice.tax_lines)`; legacy uses NHIL/GETFUND/VAT only and `!== 0` |
| **Credit note view** | Yes | Yes | `getTaxLinesForDisplay(creditNote.tax_lines)` |
| **Estimate view** | Yes | Yes | `Object.entries(allTaxLines).filter(([code, amount]) => Number(amount) > 0 && code.toUpperCase() !== "COVID")`; legacy shows nhil/getfund/vat only when > 0 |
| **Invoice public** | Yes | Yes | Only NHIL, GETFund, VAT when `> 0` |
| **Credit public** | Yes | Yes | Only NHIL, GETFund, VAT when `> 0` |
| **VAT diagnostic** | Yes | N/A (aggregated) | Only NHIL, GETFund, VAT shown in breakdown |

---

## 3. Zero-amount lines

- **getTaxLinesForDisplay:** `Number(t.amount) !== 0` → no 0 rows.
- **FinancialDocument:** `Number(line.amount) !== 0` → no 0 rows.
- **Estimate view:** `Number(amount) > 0` when from `tax_lines`; legacy uses `> 0` checks per code.
- **Invoice / credit / public pages:** Either use `getTaxLinesForDisplay` or only render when amount `> 0`.

---

## 4. No mutation of stored tax_lines

- All filtering is at render time (in-memory). No writes to `tax_lines` in DB, no schema changes, no edits to persistence or posting logic.
- `getTaxBreakdown` / `getTaxLinesForDisplay` / `getGhanaLegacyView` read only; they do not change the input.

---

## 5. Files changed (this audit)

**None.** All display paths already enforce COVID hidden and zero-amount lines hidden via:

- The canonical helper `getTaxLinesForDisplay()` in `lib/taxes/readTaxLines.ts`, or
- Equivalent filters in FinancialDocument and estimate view, or
- Display logic that only outputs NHIL, GETFund, VAT when `> 0` (invoice/credit public, VAT diagnostic).

---

## 6. Confirmation: no business or posting logic changed

- **Posting / ledger:** Unchanged. Tax engine, journal posting, and `tax_lines` persistence are untouched.
- **Business logic:** Unchanged. Validation, totals, and create/apply routes use stored values; they do not depend on UI display filtering.
- **Scope of policy:** Display-only. Stored `tax_lines` and legacy columns (e.g. `covid`) may still exist and be used for totals, reporting, and persistence; they are only hidden in UI and in any UI-oriented helpers (`getTaxLinesForDisplay`, FinancialDocument filters, and the listed pages).
