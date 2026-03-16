# C4 — Ledger Read Strategy Mapping (DESIGN ONLY)

**Objective:**  
Map **existing SQL/RPC primitives** → **ledger read contracts** (`ledger-types.ts`), **without writing SQL or code**.  
This step locks *which data source is authoritative for each reconciliation scope*.

---

## C4A — Ledger Source Decision Matrix (Authoritative)

We **do not invent new primitives yet**. We state what is used **now**, and what is **missing**.

### 1️⃣ Per-Invoice AR Balance (ledger)

**Target contract:** `LedgerBalanceByInvoice[]`

**Authoritative source (today):**
- `get_general_ledger(...)`
  - Filter: `account_id = AR`
  - Filter: `reference_type = 'invoice'`
  - Group: `reference_id`
  - Balance: `SUM(debit - credit)`

**Period handling:** Period → `period_start`, `period_end`; passed as date range.

**Status:**
- ✅ Data exists
- ⚠️ Grouping is client-side
- ❌ No period_id input
- ❌ No invoice_id filter param

**Decision:**  
✔️ **USE AS-IS for C5 implementation (read-only)**  
✳️ Flag as **performance + correctness debt** for later RPC

---

### 2️⃣ Per-Customer AR Balance (ledger)

**Target contract:** `LedgerBalanceByCustomer[]`

**Authoritative source (today):** ❌ None

**Workaround (temporary):**
- Use per-invoice AR balances
- Join invoices → customers
- Aggregate in application

**Status:**
- ❌ No RPC
- ❌ No DB primitive
- ❌ No period_id abstraction

**Decision:**  
✔️ **COMPOSE FROM per-invoice ledger balances**  
✳️ Explicitly mark as **derived**, not primitive

---

### 3️⃣ Period-Level AR Balance (ledger)

**Target contract:** `LedgerBalanceForPeriod`

**Authoritative source (today):**
- `get_trial_balance_from_snapshot(period_id)` — select AR account, use closing_balance

**Alternative:**  
`calculate_period_closing_balance_from_ledger(business_id, ar_account_id, period_id)`

**Status:**
- ✅ Period-native
- ✅ Single numeric
- ✅ Canonical

**Decision:**  
✔️ **PRIMARY:** `get_trial_balance_from_snapshot`  
✔️ **SECONDARY:** `calculate_period_closing_balance_from_ledger` (consistency check)

---

## C4B — Explicit Non-Decisions (Locked)

We **do NOT**:
- ❌ Read invoice balance from `invoices.total`
- ❌ Trust operational “remaining balance”
- ❌ Mix operational totals into ledger reconciliation
- ❌ Use payments/credits tables for ledger truth
- ❌ Invent new SQL in this step

Ledger is authoritative **by design**, not convenience.

---

## C4C — Formal Mapping Table (Locked)

| Reconciliation Scope    | Ledger Source                       | Status             |
| ----------------------- | ----------------------------------- | ------------------ |
| Invoice AR              | `get_general_ledger` + filter/group | ✅ usable           |
| Customer AR             | Derived from invoice AR             | ⚠️ composed        |
| Period AR               | `get_trial_balance_from_snapshot`   | ✅ canonical        |
| Aging                   | Ledger AR by invoice                | ✅ already designed |
| Dashboard Outstanding   | Ledger AR (future cutover)          | 🔜                 |
| Validation (pay/credit)  | Ledger AR                           | 🔜                 |

---

## What Comes Next (C5)

**C5 — Implement Reconciliation Engine (READ-ONLY)**
- No mutations
- No feature flags yet
- Pure reads + math
- Uses: `ledger-types.ts`, `expected-types.ts`, `engine.ts`
- Returns `ReconciliationResult` only

**Next:** C5A — invoice reconciliation implementation skeleton.
