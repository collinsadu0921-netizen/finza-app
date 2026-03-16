# FINZA — Payroll Calculation Audit (Ghana Statutory Compliance)

**Scope:** Read-only audit. No code changes.

**Sources traced:**  
`lib/payrollEngine/jurisdictions/ghana.ts`, `lib/payrollEngine/index.ts`, `app/api/payroll/runs/route.ts`, `supabase/migrations/047_payroll_system.sql`, `supabase/migrations/287_fix_post_payroll_to_ledger_column_names.sql`, payroll engine tests.

---

## 1. Calculation formula chain (step-by-step)

**Authority:** `lib/payrollEngine/jurisdictions/ghana.ts` (invoked via `calculatePayroll()` from `app/api/payroll/runs/route.ts`).

| Step | Formula | Code reference |
|------|--------|----------------|
| 1 | **Gross salary** = Basic salary + Allowances | `grossSalary = basicSalary + allowances` (ghana.ts:168) |
| 2 | **Employee SSNIT** = 5.5% × base (see §2) | `ssnitEmployeeAmount = roundPayroll(grossSalary * ssnitRates.employeeRate)` (ghana.ts:174) |
| 3 | **Taxable income** = Gross − Employee SSNIT | `taxableIncome = roundPayroll(grossSalary - ssnitEmployeeAmount)` (ghana.ts:177) |
| 4 | **PAYE** = Progressive tax on taxable income | `payeAmount = calculatePaye(taxableIncome, dateToUse)` (ghana.ts:179) |
| 5 | **Employer SSNIT** = 13% × base (see §2) | `ssnitEmployerAmount = roundPayroll(grossSalary * ssnitRates.employerRate)` (ghana.ts:183) |
| 6 | **Net salary** = Taxable income − PAYE − Other deductions | `netSalary = Math.max(0, roundPayroll(taxableIncome - payeAmount - otherDeductions))` (ghana.ts:186) |

**Data flow into engine (API):**  
`app/api/payroll/runs/route.ts` passes per staff: `basicSalary` (from `staff.basic_salary`), `allowances` (sum of recurring allowances), `otherDeductions` (sum of recurring deductions). Only recurring allowances/deductions are included; statutory amounts are computed inside the engine.

---

## 2. SSNIT correctness

**Rules audited:**

- Employee SSNIT: 5.5% × **?** (audit required “BASIC SALARY ONLY”).
- Employer SSNIT: 13% × **?** (audit required “BASIC SALARY ONLY”).
- Employer SSNIT must NOT reduce employee net salary.

**Implementation:**

- **Employee SSNIT:** 5.5% of **gross salary** (basic + allowances), not basic only.  
  - ghana.ts:173–174: `grossSalary * ssnitRates.employeeRate` (0.055).  
  - SQL `calculate_ssnit_employee(gross_salary)` in 047 also uses gross (that function is legacy; active path is JS engine).
- **Employer SSNIT:** 13% of **gross salary**.  
  - ghana.ts:182–183: `grossSalary * ssnitRates.employerRate` (0.13).
- **Employer SSNIT and net pay:** Employer SSNIT is not subtracted from employee pay. It is only in `employerContributions` and is debited as employer expense in the ledger. **Correct.**

**Conclusion:**

- If the statutory/organizational rule is **basic salary only**, then **both employee and employer SSNIT are incorrect** (currently on gross).
- If the rule is **gross (covered earnings)**, the implementation matches common public guidance (e.g. “gross monthly covered earnings”).
- **Defect (conditional):** SSNIT base is **gross**; if policy requires **basic only**, this is a statutory compliance defect.

---

## 3. PAYE correctness

**Rules audited:**

- Taxable income = Gross − Employee SSNIT only.
- Correct PAYE bands and progressive calculation.

**Implementation:**

- **Taxable income:** `taxableIncome = grossSalary - ssnitEmployeeAmount` (ghana.ts:177). **Correct.**
- **Bands (ghana.ts:44–54, 115–155):**  
  - 0–490: 0%  
  - 491–650: 5%  
  - 651–3,850: 10%  
  - 3,851–20,000: 17.5%  
  - 20,001–50,000: 25%  
  - 50,001+: 30%  
  Matches GRA-style monthly bands and matches SQL `calculate_ghana_paye()` in 047.
- **Progressive calculation:** Implemented as cumulative band-by-band (e.g. 131–135 for 491–650, 136–139 for 651–3850, etc.). Logic matches the SQL version. **Correct.**

**Conclusion:** PAYE formula (taxable income = gross − employee SSNIT) and band/progressive logic are **correct**.

---

## 4. Net salary correctness

**Rule audited:**  
Net = Gross − Employee SSNIT − PAYE − Deductions.

**Implementation:**  
`netSalary = taxableIncome - payeAmount - otherDeductions` with `taxableIncome = grossSalary - ssnitEmployeeAmount`. So:

- Net = (Gross − Employee SSNIT) − PAYE − Other deductions = Gross − Employee SSNIT − PAYE − Deductions. **Correct.**

Other (voluntary) deductions are applied after PAYE and do not affect taxable income; they only reduce net. **Correct.**

---

## 5. Ledger posting correctness

**Function:** `post_payroll_to_ledger(p_payroll_run_id)` in `supabase/migrations/287_fix_post_payroll_to_ledger_column_names.sql`.

**Source of totals:**  
Reads from `payroll_runs`: `total_gross_salary`, `total_allowances`, `total_ssnit_employer`, `total_paye`, `total_ssnit_employee`, `total_net_salary`. No recalculation; uses stored run totals. **Correct.**

**Journal lines (287):**

| # | Account (type)        | Debit                    | Credit |
|---|------------------------|--------------------------|--------|
| 1 | Payroll Expense (5600) | v_total_gross + v_total_allowances | 0      |
| 2 | SSNIT Employer Exp (5610) | v_total_ssnit_employer   | 0      |
| 3 | PAYE Payable (2230)   | 0                        | v_total_paye |
| 4 | SSNIT Payable (2231)  | 0                        | v_total_ssnit_employee + v_total_ssnit_employer |
| 5 | Net Salaries Payable (2240) | 0                  | v_total_net |

**Balance check:**  
Debits = (v_total_gross + v_total_allowances) + v_total_ssnit_employer.  
Credits = v_total_paye + (v_total_ssnit_employee + v_total_ssnit_employer) + v_total_net.

For the run to balance:  
(v_total_gross + v_total_allowances) + v_total_ssnit_employer = v_total_paye + v_total_ssnit_employee + v_total_ssnit_employer + v_total_net  
⇒ v_total_gross + v_total_allowances = v_total_paye + v_total_ssnit_employee + v_total_net.

Per-employee identity: gross = net + ssnit_employee + paye + other_deductions. So summed: total_gross_salary = total_net + total_ssnit_employee + total_paye + total_deductions. But in the API, `total_gross_salary` is set to **sum of (basic + allowances)** i.e. total gross already including allowances. And `total_allowances` is also stored separately. So:

- total_gross_salary = Σ(basic_i + allowances_i) = total_basic + total_allowances.
- Ledger debit for payroll expense = total_gross_salary + total_allowances = (total_basic + total_allowances) + total_allowances = total_basic + 2× total_allowances.

So **allowances are effectively double-counted** in the payroll expense debit. The journal entry is then **not** consistent with the economic total (which should be total_gross_salary = total_basic + total_allowances once). **Defect.**

**Other checks:**

- **Allowances in gross:** Included in engine (gross = basic + allowances) and in run totals (total_gross_salary includes them). **Correct.**
- **Employer SSNIT not in employee deductions:** Employer SSNIT is not deducted from net; it appears only as employer expense. **Correct.**
- **Period check:** 287 calls `assert_accounting_period_is_open(v_business_id, v_payroll_month)` before posting. **Correct.**
- **Run linkage:** Approval flow sets `journal_entry_id` on `payroll_runs` (per PAYROLL_LEDGER_POSTING_CANONICAL_AUDIT_AND_FIX.md), preventing duplicate posting. **Correct.**

---

## 6. List of defects

| # | Severity | Description |
|---|----------|--------------|
| 1 | **Conditional** | **SSNIT base:** Employee and employer SSNIT are calculated on **gross salary** (basic + allowances). If Ghana statutory or internal policy requires SSNIT on **basic salary only**, this is a compliance defect. If the rule is gross (e.g. “gross monthly covered earnings”), implementation is correct. |
| 2 | **High** | **Ledger double-count of allowances:** `post_payroll_to_ledger` debits Payroll Expense with `v_total_gross + v_total_allowances`. But `total_gross_salary` in `payroll_runs` is already the sum of per-employee gross (basic + allowances), so it already includes allowances. Adding `total_allowances` again doubles allowances in the expense debit. **Fix:** Debit payroll expense by `v_total_gross` only (or ensure run totals are defined so that “gross” in the ledger does not already include allowances and the naming is consistent). |

No other defects identified for: PAYE formula and bands, taxable income, net salary formula, employer SSNIT not reducing net, or use of run totals in the ledger (aside from the allowance double-count).

---

## Summary table

| Rule | Status |
|------|--------|
| Gross = Basic + Allowances | ✅ Correct |
| Allowances included in gross | ✅ Correct |
| Employee SSNIT 5.5% | ⚠️ On **gross**; if basic-only required → defect |
| Employer SSNIT 13% | ⚠️ On **gross**; if basic-only required → defect |
| Employer SSNIT not in employee net | ✅ Correct |
| Taxable income = Gross − Employee SSNIT | ✅ Correct |
| PAYE bands and progressive calc | ✅ Correct |
| Net = Gross − Employee SSNIT − PAYE − Deductions | ✅ Correct |
| Ledger uses run totals | ✅ Correct |
| Journal balanced (conceptually) | ❌ No: allowances double-counted in expense debit |
| Employer SSNIT not in deductions from employee | ✅ Correct |
