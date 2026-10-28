# Ghana SSNIT annual limits — provisional and official transitions

## Current interim state

- The latest officially verified annual SSNIT limits are the **2026** notice:
  minimum GH₵587.80 and maximum GH₵69,000.
- `gh-pension-2027-provisional` reuses those limits for January–December 2027.
- Provisional payroll is allowed for calculation, approval, payment and locking,
  but approval requires an explicit employer acknowledgement. The acknowledgement
  user and timestamp are stored on `payroll_runs`.
- Each provisional run snapshots the actual limits, their statutory effective
  date (2026-01-01) and `pension_limits_provisional = true`.
- PAYE remains on its own effective-dated schedule and is unchanged by this
  interim SSNIT treatment.

## When the official SSNIT notice is published

1. Add an official pension version (for example `gh-pension-2027-01`) in
   `lib/payrollEngine/jurisdictions/ghanaStatutoryRates.ts` with:
   - the official minimum and maximum insurable earnings;
   - `effectiveFrom` equal to the statutory effective date in the notice;
   - `limitsEffectiveFrom` equal to the same date;
   - no `isProvisional` flag.
2. Add a migration that:
   - adds the official version to `payroll_ghana_expected_pension`;
   - returns the official version from
     `payroll_ghana_confirmed_pension_version_for_period` for the relevant year.
3. Deploy the code and migration together. New runs and newly recalculated
   drafts then select the confirmed version automatically.
4. Approval of any remaining provisional draft automatically refreshes the draft
   onto the official version before validation. If that refresh cannot complete,
   approval stays blocked; provisional limits are never silently finalized after
   official limits are configured.
5. Review paid/locked provisional runs with:

   ```bash
   node scripts/ghana-ssnit-provisional-diff.mjs --official-version=gh-pension-2027-01
   ```

   The report is read-only and shows employee/employer SSNIT, Tier 1/2, PAYE
   and net differences per employee.
6. For runs with differences, use the existing controlled correction path:
   reverse the run through `reverse_payroll_run_atomic`, create the correction
   draft with `create_payroll_correction_draft_from_reversed`, let the draft
   refresh to official limits, approve it, and pay only the resulting adjustment
   through the existing payment workflow.

Do not edit historical journals and do not create a second payment for the full
original net salary.

## Guardrails

- Approved, locked and reversed runs remain immutable.
- Payments, locking, reversals and accounting journals keep their existing
  safeguards.
- A provisional run cannot be approved without an acknowledgement.
- Once a confirmed annual version exists for a period, a provisional run is
  recalculated before approval or blocked from finalisation.
