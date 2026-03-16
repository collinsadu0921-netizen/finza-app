# Allowances & Deductions Constraint Audit — Report

## 1. Current DB CHECK constraints

**Source:** `supabase/migrations/047_payroll_system.sql`

| Table       | Column | Constraint name (inferred) | Full CHECK expression | Allowed values |
|------------|--------|----------------------------|------------------------|----------------|
| **allowances** | `type` | `allowances_type_check` | `type IN ('transport', 'housing', 'utility', 'medical', 'bonus', 'other')` | transport, housing, utility, medical, bonus, other |
| **deductions** | `type` | `deductions_type_check` | `type IN ('loan', 'advance', 'penalty', 'other')` | loan, advance, penalty, other |

Both columns are `TEXT NOT NULL` with an inline CHECK; PostgreSQL names the constraint from the expression (e.g. `allowances_type_check`).

---

## 2. UI allowed values (before fix)

- **Allowances:** Free-text input — any string was possible (e.g. "Transport", "Fixed", "tax").
- **Deductions:** Free-text input — same.

**After fix:** UI uses dropdowns with the exact DB values as option values and human-readable labels (e.g. "Transport" → value `transport`).

---

## 3. API payload examples

**POST /api/staff/:id/allowances**

```json
{
  "type": "transport",
  "amount": 100,
  "recurring": true,
  "description": null
}
```

**POST /api/staff/:id/deductions**

```json
{
  "type": "loan",
  "amount": 50,
  "recurring": true,
  "description": null
}
```

**PUT /api/staff/:id/allowances/:allowanceId** and **PUT .../deductions/:deductionId** accept the same fields; `type` is optional on update.

Before the fix, the API passed `type` through with no normalization or validation, so values from the UI went straight to the DB.

---

## 4. Root cause

**Type: (A) UI sends value not allowed by DB**

- The UI used **free-text** inputs for allowance and deduction type. Users could enter:
  - Different casing: "Transport", "transport", "Loan", "loan"
  - Values not in the DB enum: "Fixed", "tax", "voluntary", "statutory"
- The API did not normalize or validate `type` before insert/update, so invalid or differently cased values reached the DB and triggered the CHECK constraints.

No change was made to the DB constraints; they remain the single source of truth.

---

## 5. Minimal patch applied

| Layer | Change |
|-------|--------|
| **Shared** | Added `lib/payrollTypes.ts`: `ALLOWANCE_TYPES`, `DEDUCTION_TYPES`, `normalizeAllowanceType()`, `normalizeDeductionType()`, and `ALLOWANCE_TYPE_OPTIONS` / `DEDUCTION_TYPE_OPTIONS` for UI. |
| **API** | **POST** allowances/deductions: normalize `type` to lowercase and validate against allowed list; if invalid, return **400** with `code: "INVALID_ALLOWANCE_TYPE"` or `"INVALID_DEDUCTION_TYPE"` and `allowed: [...]`. Insert/update only with normalized type. |
| **API** | **PUT** allowance/deduction: when `type` is present in body, same normalization and validation; 400 with same codes if invalid. |
| **UI** | Staff page: replaced type **text** inputs with **select** dropdowns using `ALLOWANCE_TYPE_OPTIONS` and `DEDUCTION_TYPE_OPTIONS` (value = DB value, label = display text). |

**DB:** No migration. Constraint definitions unchanged.

---

## 6. Payroll / ledger posting unchanged

- **post_payroll_to_ledger** (and related migrations) use only:
  - `payroll_runs.total_gross_salary`
  - `payroll_runs.total_allowances`
  - `payroll_runs.total_deductions`
  - etc.
- They do **not** read `allowances.type` or `deductions.type`. Posting is driven by pre-calculated totals on `payroll_runs`; the `type` field is for categorization only and does not affect journal or ledger logic.
- No changes were made to payroll calculation, payroll run creation, or any accounting/posting code.

---

## 7. Validation improvement (defensive layer)

- **Before insert/update:** The API now validates `type` and returns **400** with explicit codes (`INVALID_ALLOWANCE_TYPE` / `INVALID_DEDUCTION_TYPE`) and the list of allowed values, so the DB CHECK is no longer the first failure point.
- **Normalization:** All incoming `type` values are trimmed and lowercased and must match the allowed list; only the normalized value is written to the DB.
- **UI:** Dropdowns guarantee only valid values are submitted for new records; edits also use the same options so stored values remain valid.

---

## Regression testing checklist

- **Allowances:** Create and edit with types: transport, housing, utility, medical, bonus, other. Run payroll; confirm ledger posting still uses totals correctly.
- **Deductions:** Create and edit with types: loan, advance, penalty, other. Same payroll run and ledger check.
- **Invalid type:** Send e.g. `type: "tax"` or `type: "Fixed"` to the API; expect 400 with `INVALID_ALLOWANCE_TYPE` or `INVALID_DEDUCTION_TYPE` and no DB insert/update.
