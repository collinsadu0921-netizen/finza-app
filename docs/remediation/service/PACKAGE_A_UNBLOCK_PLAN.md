# Package A unblock plan

Status date: 11 October 2026. Planning only. No implementation is authorized by this file.

Package A remains NOT READY. Three assignments stay separate. Assignment 3 does not start until Assignments 1 and 2 have evidence. None of this is permission to deploy, to apply migration 588 on production, or to start Package B.

## Assignment 1 — Platform compatibility

Owner of the work: a platform change, not the payment implementation.

Branch to create later, not now: `fix/next16-route-params` from `ee5cdb2256b59baccf85a598fbc53e083153e53b`. New worktree. Do not merge `fix/next16-dynamic-params`. Do not edit the Package A payment files in that branch.

Deliverable: lint, TypeScript, and `npm run build` pass on a clean `npm ci`.

In scope:

- Narrow the 99 `params` unions to `Promise` only. Keep the existing `await Promise.resolve(params)` or switch to `await params`. Do not reorder authorization.
- Point the `lint` script at ESLint. Do not disable rules. Do not set `--max-warnings 0` in that change.
- The Retail file `app/api/retail/expenses/[id]/route.ts` and a review of `app/api/users/[id]/store/route.ts`. The Retail file needs an explicit owner yes before it is edited. A green build needs it.

Out of scope: payment behavior, migration 588, staging env, `eslint-config-next` upgrade, Package B.

Detail: `PLATFORM_COMPATIBILITY_AUDIT.md`.

## Assignment 2 — Staging readiness

Deliverable: one isolated staging application with Paystack test mode, aimed at Supabase `adonhhtooawkeemdqqeo`, on a URL that is not `app.finza.africa`.

In scope:

- Prove the existing preview branch `staging` database URL, or replace it.
- Add branch-scoped test Paystack keys and the tenant-invoice flag. Do not copy production secrets.
- Stop preview from using the production Resend credential.
- Rotate the staging service role if `.env.staging.example` exposed it.
- Give testers a way through Vercel SSO without opening production.
- Leave migration 588 as it is on staging. Do not apply it to production.

Out of scope: route type edits, Package A scenario execution, new paid Supabase projects.

Detail: `STAGING_READINESS_AUDIT.md`.

## Assignment 3 — Package A acceptance

Depends on Assignment 1 and Assignment 2.

Deliverable: all 12 HTTP scenarios executed against the staging app, including two overlapping verify requests, with database evidence of one payment and one journal. Update `PACKAGE_A_ACCEPTANCE_REPORT.md` from those runs. Do not mark a scenario passed from Jest or from the earlier SQL insert test.

The payment implementation stays the one already in `finza-payment-auth`. This assignment runs it. It does not expand it.

## Release gates before any owner release review

- Package A diff reviewed on its own.
- Assignment 1 build, lint, and TypeScript are green.
- Package A Jest is green on that combination.
- Staging isolation checks in the staging audit are true, not assumed.
- All 12 HTTP scenarios passed.
- Migration 588 matches the file on staging and is still absent on production until a separate apply approval.
- Retail impact is the one type signature, or a written exception if the build is allowed to stay red.
- Production apply order is written: fresh duplicate check, apply 588, then deploy settlement. Rollback is redeploy the previous production deployment and drop only `payments_reference_fnz_invoice_unique`.
- Owner approval names the commit. This plan is not that approval.

## Order

1. Owner approves Assignment 1, including the Retail type file or an explicit exception.
2. Owner approves Assignment 2 credentials and the staging URL. Assignments 1 and 2 can proceed in parallel after that.
3. Combine the green compatibility commit and the Package A payment commit only when both are reviewed.
4. Deploy that combination to the staging preview. Run Assignment 3.
5. Stop. Production deploy and the production migration stay behind a later approval.

Do not use production as the acceptance database. Do not run a live charge.
