# VAT Report Logic – January 2026 Correctness Audit

## Objective

Confirm VAT page correctness for January 2026.

**Scope:** VAT report logic only. **Rules:** Read-only.

---

## 1. VAT Reporting Surfaces in Scope

| Surface | Route / API | Purpose |
|--------|-------------|---------|
| **VAT page** | `/reports/vat` → `GET /api/reports/vat-control` | VAT Control (account 2100) |
| **VAT Returns calculate** | `POST /api/vat-returns/calculate` | Ghana VAT return calculation |
| **VAT Returns monthly** | `GET /api/vat-returns/monthly` | Monthly VAT return summaries |

**Out of scope:** Tax summary (deprecated 410), accounting VAT export (separate export flow).

---

## 2. Output VAT Calculation Sources

### 2.1 VAT page (VAT Control)

| Item | Source | Details |
|------|--------|--------|
| **Output VAT** | `journal_entry_lines` | Sum of **credits** to account **2100** in period. Label: "VAT Collected." |
| **Filter** | `journal_entries.date` in `[start_date, end_date]` | Date range from UI. |

**Verified:** Output VAT = period credits to 2100. Source is ledger only.

### 2.2 VAT Returns calculate

| Item | Source | Details |
|------|--------|--------|
| **Output VAT** | `invoices`, `credit_notes` | Invoices: `status = 'paid'`, `apply_taxes = true`, `issue_date` in period. Credit notes `status = 'applied'`, `date` in period. |
| **Formula** | `Σ(inv.vat) − Σ(cn.vat)` | Excludes credit-note VAT from output. |

**Verified:** Output VAT from paid, tax-applied invoices minus applied credit notes. Correct.

### 2.3 VAT Returns monthly

| Item | Source | Details |
|------|--------|--------|
| **Output VAT** | `invoices` (and credit notes if used) | Per-month grouping by `issue_date`. `output_vat` = Σ `inv.vat` for month. |

**Verified:** Consistent with calculate; output from invoices.

---

## 3. Input VAT Calculation Sources

### 3.1 VAT page (VAT Control)

| Item | Source | Details |
|------|--------|--------|
| **Input VAT** | `journal_entry_lines` | Sum of **debits** to account **2100** in period. Label: "VAT Reversed." |

**Verified:** Input VAT = period debits to 2100. Ledger-only.

### 3.2 VAT Returns calculate

| Item | Source | Details |
|------|--------|--------|
| **Input VAT** | `expenses`, `bills` | Expenses: `date` in period, **filtered to `vat > 0` only**. Bills: `issue_date` in period, with tax. |
| **Comment** | "Only VAT is deductible" | Lines 129, 186–187, 206–208. |
| **Formula** | `Σ(exp.vat) + Σ(bill.vat)` | No NHIL/GETFund/COVID in input VAT. |

**Verified:** Input VAT from expenses and bills; only VAT used. Correct.

### 3.3 VAT Returns monthly

| Item | Source | Details |
|------|--------|--------|
| **Input VAT** | `expenses`, `bills` | `input_vat` = Σ `exp.vat` + Σ `bill.vat` per month. |

**Verified:** Same logic as calculate; input from expenses and bills.

---

## 4. NHIL, GETFund, COVID: Reporting vs Deductible

### 4.1 Included in reporting?

| Surface | NHIL | GETFund | COVID | Notes |
|--------|------|---------|-------|--------|
| **VAT page** | **No** | **No** | **No** | Uses **only** account 2100. No separate levies. |
| **VAT Returns calculate** | **Yes** | **Yes** | **Yes** | `total_output_nhil/getfund/covid`, `total_input_*`, `total_output_tax`, `total_input_tax`. |
| **VAT Returns monthly** | **Yes** | **Yes** | **Yes** | `output_nhil/getfund/covid`, `input_*`, all in `monthlyReturns`. |

### 4.2 Excluded from deductible VAT?

| Surface | Logic | Verified |
|--------|--------|----------|
| **VAT Returns calculate** | "NHIL, GETFund, COVID on expenses are ignored for VAT return purposes." Net = `output VAT − input VAT` only. | **Yes** |
| **VAT Returns monthly** | "NHIL, GETFund, COVID are levies (report-only, not deductible)." `net_vat = output_vat − input_vat`. | **Yes** |
| **VAT page** | No deductibility logic; single account 2100. | N/A |

**Conclusion:**  
- **VAT page:** NHIL, GETFund, COVID are **not** included in reporting (only 2100).  
- **VAT Returns:** NHIL, GETFund, COVID **are** included in reporting and **are** excluded from deductible VAT.

---

## 5. Net VAT Payable Formula

### 5.1 VAT page (VAT Control)

| Item | Formula | Notes |
|------|--------|-------|
| **Closing balance** | `opening + vat_collected − vat_reversed` | Equals opening + credits − debits. |
| **Invariant** | `opening + credits − debits = closing` | Checked in UI. |

No explicit "Net VAT Payable" label; closing is the liability balance. Formula itself is correct.

### 5.2 VAT Returns calculate

| Item | Formula | Location |
|------|--------|----------|
| **Net VAT Payable** | `max(totalOutputVat − totalInputVat, 0)` | Line 214. |
| **Net VAT Refund** | `max(totalInputVat − totalOutputVat, 0)` | Line 215. |

**Verified:** Net VAT = output VAT − input VAT; levies not used. Correct.

### 5.3 VAT Returns monthly

| Item | Formula | Location |
|------|--------|----------|
| **Net VAT** | `output_vat − input_vat` | Line 211. |

**Verified:** Same concept; levies not in net. Correct.

---

## 6. January 2026 Specifics

| Check | Result |
|-------|--------|
| **COVID removed from 2026** | Ledger extraction (`extract_tax_return_from_ledger`, migration 093): **skips** account 2130 (COVID) for `p_start_date >= '2026-01-01'`. |
| **VAT page** | Uses 2100 only. Posting: VAT→2100; NHIL/GETFund/COVID→2110/2120/2130. Jan 2026 VAT Control unaffected. |
| **VAT Returns** | No date-based COVID filter in calculate/monthly. Jan 2026 returns use invoices **issued** in Jan 2026; tax engine does not add COVID for 2026, so `covid` = 0. |

**Verified:** January 2026 handling is correct.

---

## 7. Discrepancies

| # | Surface | Issue |
|---|---------|-------|
| 1 | **VAT page** | NHIL, GETFund, COVID are **not** included in reporting. The page uses only account 2100. If "VAT page" must report levies, this is a **gap**. |
| 2 | **VAT page** | No explicit "Net VAT Payable" metric; only closing balance. Semantically equivalent but not explicitly labeled. |

No discrepancies found in **VAT Returns** logic (calculate / monthly).

---

## 8. Summary

| Surface | Output VAT | Input VAT | NHIL/GETFund/COVID in reporting | Excluded from deductible | Net VAT formula | Jan 2026 |
|--------|------------|-----------|----------------------------------|---------------------------|------------------|----------|
| **VAT page** | ✓ Credits 2100 | ✓ Debits 2100 | **✗ Not included** | N/A | ✓ closing = opening + credits − debits | ✓ |
| **VAT Returns calculate** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **VAT Returns monthly** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 9. Confirmation

**VAT Returns logic (calculate, monthly): CORRECT**

- Output VAT: invoices (and credit notes where applicable); input VAT: expenses + bills (VAT only).  
- NHIL, GETFund, COVID included in reporting, excluded from deductible.  
- Net VAT Payable = output VAT − input VAT.  
- January 2026: COVID correctly excluded (ledger extraction); VAT Returns rely on 2026 invoice data.

**VAT page (VAT Control): NOT fully correct** for the stated criteria.

- Output/input VAT sources and net-style formula (closing balance) are correct.  
- **NHIL, GETFund, COVID are not included in reporting** on the VAT page (2100 only).  
- If the audit scope requires the **VAT page** to include levies and explicit Net VAT Payable, then:

  **Overall: NOT** — due to VAT page gap on levies (and optional labelling of Net VAT Payable).

If the scope is **VAT Returns only**, then **CORRECT**.

---

## 10. Root Cause of VAT Page Gap

The VAT page (`/reports/vat`) calls only `GET /api/reports/vat-control`, which reads **account 2100**. Levies (2110, 2120, 2130) are never queried or displayed. Including them would require either using `extract_tax_return_from_ledger` (or equivalent) or extending vat-control to aggregate 2100–2130 and surface them on the VAT page.
