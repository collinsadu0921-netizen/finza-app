# Finza Service — Release gates

Status date: 11 October 2026.

A green build is not release approval. A passing test is not a closed defect. Production financial corrections need their own authorization and a written correction plan. This document does not grant that authorization.

Each gate is mandatory for any Service package that changes code, a database function, or production data. Package A is the only package with an implementation, and it has not passed these gates.

## 1. Root-cause verification

The register entry states the cause from code or from stored rows, not from a missing QA paragraph. `NEEDS REPRODUCTION`, `NOT REPRODUCED`, and `BLOCKED` entries do not enter a release. QA-001 cannot pass this gate.

## 2. Scope review

The diff is limited to the package. Retail routes, POS, Retail permissions, Retail payment integrations, and Retail tests are absent from the diff. Shared files are listed. If a shared file is in the diff, gate 2 fails until an architectural review says the change cannot alter Retail, or the shared file is removed from the package.

Package A currently satisfies the Retail exclusion: `app/api/payments/momo/route.ts` has no diff against HEAD. SEC-006 is not in the Package A diff and must stay out.

## 3. Code review

A reviewer other than the author reads the package against the register entry. The review checks authorization, idempotency, and what happens when the provider or the database returns an error. Uncommitted work is not reviewed by its existence in a working tree.

## 4. Automated testing

The package's required tests pass on the release commit. The relevant invariants in `ACCOUNTING_INVARIANTS.md` have a test named in the release note, or an explicit gap the owner accepts. Package A's latest run is 15 suites and 78 tests, including verify and OTP binding and Hubtel token delegation. They mock the provider and the database. The staging SQL concurrency test is separate and is not a release-commit result.

## 5. Financial reconciliation

For any change that posts or reports money, a staging tenant is reconciled before production: journals balance, the source document matches its journal, and cash collected matches payments. Read-only production checks do not replace this. Package A must show that a pending Paystack status creates no payment and no journal.

## 6. Tenant-isolation testing

Tests use two tenants. A token, invoice id, or business id from one does not read or settle the other. Public invoice pay uses `invoices.public_token` only. Package A has local tests for this on charge and tenant MoMo. They must be re-run on the release commit.

## 7. Database migration review

Every migration is named, reversible, and checked against current production data with a read-only query before apply. Package A's only migration is `588_paystack_invoice_payment_reference_unique.sql`. It is applied on staging `adonhhtooawkeemdqqeo` and not on production. A read-only production check after the staging apply still found the index absent and 0 live invoice `FNZ-` rows. That check is repeated immediately before any production apply. No other migration is part of Package A. Migration 587 is already applied and is not reapplied.

## 8. Isolated staging acceptance

Acceptance runs on a staging database that is not Finza Pro. The demo tenant used in the October investigation lives on the production database, so it is not the acceptance tenant. Staging project `adonhhtooawkeemdqqeo` was used for migration 588 and a synthetic insert test, and the fixture was deleted. There is no staging application of this branch, so the twelve HTTP scenarios were not run. Staging application code is not assumed to contain `ee5cdb2`. The package is deployed to staging as itself before those scenarios can pass.

## 9. Production build validation

The release commit completes the production build used by Vercel. Local `npx next build --webpack` on 11 October 2026 compiled after the control-tower `params` correction and then failed on `app/api/accounting/afs/[run_id]/finalize/route.ts` (INF-001). That sweep stopped. `npm run build` was not re-run; Turbopack previously rejected this worktree's `node_modules` junction. Targeted ESLint now lints Package A with 0 errors and 3 warnings. `npm run lint` still does not invoke ESLint (INF-002). Gate 9 is open.

## 10. Owner approval

The owner accepts the register entries in the package, the diff, the migration list, and any remaining test gaps. This programme is waiting at this gate. No package starts coding, and Package A is not committed or deployed, until that approval names the package.

## 11. Controlled deployment

One package, one production deployment, from the approved commit. No merge of staging into production. No second deploy while an upload is unfinished. Production releases are CLI deploys. After deploy, the newest READY production deployment is recorded and compared with the approved SHA. The current production deployment stays `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` until that happens.

## 12. Post-deployment verification

Smoke checks do not print secrets and do not create a live charge. For Package A, confirm a missing token is rejected and a pending status is not settled, using fixtures or read-only inspection. Watch the payment and journal tables for duplicate `FNZ-` references after the first real payments. A defect moves to `RELEASED` only after this gate. It moves to `CLOSED` only after the owner accepts the production evidence. A green build does not do either.

## Production financial corrections

LED-001 and LED-004 are the only historical ledger candidates identified. They are not corrected by a code deploy. A correction plan names each journal id, the proposed reversing entry, the businesses affected, and the rollback. The owner approves that plan separately. Expense pairs that are reversals (LED-003) are not candidates. The 13 fully credited invoices (INV-001) are not bulk-updated.
