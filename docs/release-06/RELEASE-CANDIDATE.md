# Release 06 — isolated proposal release candidate

## Identity

| Item | Value |
|---|---|
| Branch | `release/proposal-security-06` |
| Candidate HEAD | `3f7ff156a1c07513e6ba79bb847ef2d1cfe459a3` |
| Production baseline | `ef29c70d164d8e988c5134ca45e66614c8213442` (`origin/main`) |
| Proposal source | `2a40c90bb5d06a36a198c28cc8add8f80b7a610b` (Stage 04) |
| Security remediation | `feat/proposal-security-release06` |
| Verified Preview | `https://finza-r1qh2q3oq-collins-projects-f49524b8.vercel.app` |
| Deployment target | Authorised Vercel Preview only; no production deployment |

The release candidate is based directly on the current `origin/main` production baseline. It is **not** a promotion of `origin/staging`.

## Included commits

- The 28 proposal commits from `ddfc01a` through `2a40c90` (Stage 01–04), cherry-picked in order.
- `fix(proposals): enforce tenant-bound assets and direct uploads` — Release 06 remediation, migration 702, upload intent/finalize, MIME validation, Storage policies, cover labels and PDF ligature fix.
- `chore(release): include proposal editor export link dependency` — the dependency-free `components/ui/ExportButton.tsx` primitive required by the proposal editor.
- Release-06 research, incident and release-candidate documentation.

## Scope audit

`git diff --shortstat origin/main..HEAD` (final candidate):

```text
80 files changed, 10673 insertions(+), 656 deletions(-)
```

Non-proposal paths are limited to required support code:

- `.env.example` — OpenAI proposal variables
- `app/globals.css` — local Gelasio font faces
- `lib/pdf/renderHtmlToPdf.ts` — proposal PDF font/image readiness
- `components/ui/ExportButton.tsx` — shared editor link primitive
- `vercel.json` — proposal upload cleanup cron
- Release-06 docs and migration 702

No accounting, payroll, retail, VAT, practice or other unrelated staging functionality is included.

The full `origin/main..origin/staging` diff remains approximately 137 commits / 896 files and is **not** part of this candidate.

## Required migrations

| Migration | Purpose | Production action |
|---|---|---|
| `430_service_proposals.sql` | Proposal tables, bucket and original policies | Verify applied/equivalent; the staging ledger omitted 430 even though tables existed |
| `700_proposal_premium_reader.sql` | Cover asset, typography and constraints | Apply before deploying the candidate |
| `701_proposal_ai_and_invoice_conversion.sql` | AI/conversion traceability | Apply before deploying the candidate |
| `702_proposal_asset_security.sql` | Tenant-bound immutable paths, column privileges, trigger, upload state and Storage policies | Apply before deploying the candidate; verify policies and run the cross-tenant regression |

`702_proposal_asset_security.rollback.sql` is an emergency rollback only; it restores the vulnerable policy shape and should not be run automatically.

## Verification

- TypeScript: `npx tsc --noEmit` → exit `0`.
- Jest: `npx jest --runInBand lib/proposals app/api/proposals` → **17/17 suites, 110/110 tests**.
- Release 05 evidence remains available at `C:\Users\colli\Desktop\finza-proposal-release05-evidence\` for comparison.
- Release 06 staging verification and visual UAT will be recorded in the final Release 06 report.

## Rollback

- Application: redeploy the previous production deployment/commit. The proposal feature is additive and `standard_v1` remains supported.
- Database: migrations 700/701 are additive. Migration 702 adds a column, constraints, trigger, helper functions and policies; it does not drop proposal data. Do not drop the new columns during a rollback unless a separate data-retention decision requires it.
- Migration 702 rollback restores the old vulnerable policy; use only under incident command and replace it with a proper forward fix immediately.

## Production deployment constraints

- Do not merge this branch into `main` without review and approval.
- Do not deploy to production from this task.
- Do not apply migrations 700/701/702 to production from this task.
- Production has an unverified proposal surface; see `SECURITY-INCIDENT-ASSESSMENT.md`.
