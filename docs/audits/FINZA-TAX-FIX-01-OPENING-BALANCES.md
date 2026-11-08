# Opening Balances and Tax Control Accounts — Recommendation

**Task:** FINZA-TAX-FIX-01 (Stage E)  
**Audit finding:** TAX-09 — opening balances cannot carry tax control accounts  
**Status:** Recommendation only. No workflow was implemented under this task.

## 1. Current behaviour

`lib/accountingPeriods/accountEligibility.ts` allows only asset, liability and
equity accounts for opening balances, and rejects every system account. That
includes the tax control accounts:

| Code | Account |
|---|---|
| 2100 | VAT Payable |
| 2110 | NHIL Payable |
| 2120 | GETFund Payable |
| 2130 | COVID Levy Payable |
| 2200 | Other Tax Liabilities |
| 2210 | PAYE Liability |
| 2220 | SSNIT Employee Contribution Payable |
| 2230 | SSNIT Employer Contribution Payable |
| 2240 | Net Salaries Payable |

The restriction is intentional: it prevents ordinary opening-balance imports
from overwriting control accounts that must reconcile to operational tax
records and the ledger.

## 2. Production assessment

A read-only production check found no business named “Proceed Investments” and
no opening-balance batches for a Proceed business. The finding is therefore a
future cutover concern, not a current production calculation defect.

No production opening-balance data was created, changed or backfilled.

## 3. Why a normal opening-balance import is not safe for tax controls

A tax control account opening balance must agree with:

- the opening VAT/WHT/PAYE liability carried into the new ledger;
- the first filed return or remittance after cutover;
- the trial balance and control-account reconciliation;
- the source documents that created the liability.

A generic opening-balance line does not carry that evidence. It can also bypass
the normal tax-posting and period-lock rules if the eligibility guard is simply
removed.

## 4. Recommended separate implementation

Do not relax the global opening-balance eligibility rules. Implement a
dedicated, separately authorized cutover workflow:

1. **Dedicated batch type.** Add an explicit `tax_control_cutover` opening
   balance batch type. It must be available only to owner/accountant roles with
   an explicit confirmation and audit reason.
2. **Evidence per line.** Each tax control line must carry the tax type,
   period, source reference (filed return, GRA receipt or opening trial
   balance), and the supporting document. A line without evidence must be
   rejected.
3. **Balanced posting only.** Post the batch through the canonical
   `post_journal_entry` path, with a dedicated reference type and one journal
   per batch. Never insert journal lines directly.
4. **Period and lock enforcement.** Post into a dedicated opening period that
   is open only for the cutover, then lock it. Do not allow later edits.
5. **Reconciliation gate.** Before the batch can be finalized, require:
   - total debits = total credits;
   - each tax control line equals its supporting return/receipt;
   - the trial balance ties to the imported opening balances;
   - no unresolved reconciliation exceptions.
6. **Idempotency and one-time use.** A business may have at most one finalized
   tax-control cutover batch per accounting period. Retries return the existing
   batch; they never post a second journal.
7. **Audit and reversal.** Record the preparer, reviewer, evidence references
   and journal ID. Corrections require an auditable reversal and replacement
   batch, not an edit of the finalized batch.
8. **Reporting.** Include the cutover lines in the opening-balance report and
   the tax control reconciliation. The first post-cutover VAT/WHT return must
   reconcile to the opening balance plus period movement.

## 5. Explicit non-goals for FINZA-TAX-FIX-01

- No change to `FORBIDDEN_SYSTEM_CODES` or the global eligibility rules.
- No new opening-balance tables or RPCs.
- No production tax records, opening balances or journals were modified.
- No assumption that Proceed Investments requires this workflow until the
  onboarding accountant confirms the opening tax liabilities and evidence.

## 6. Acceptance criteria for the separate task

- A cutover batch can include 2100–2240 only through the dedicated workflow.
- Ordinary opening-balance imports still reject those accounts.
- The batch posts one balanced, auditable journal.
- The tax control balance equals the supporting return/receipt.
- A retry does not duplicate the batch or journal.
- The finalized batch is immutable; corrections use reversal and replacement.
- The trial balance and the first post-cutover tax return reconcile.
