# Package A acceptance report

Status date: 11 October 2026. Release-blocker remediation only. Nothing was committed, pushed, merged, or deployed. Migration 588 was applied to the isolated staging database and was not applied to production. Production data was not changed. No live payment charge was sent.

## Verdict

NOT READY

This verdict is not authorization to deploy.

Local Service payment tests passed again. The ESLint configuration now loads, and a targeted lint of the Package A files completed with warnings and no errors. The repository lint script still does not run ESLint. The control-tower page type was corrected, and the production build then failed on the next pre-existing accounting route. That sweep was stopped. Staging database isolation was checked, migration 588 was applied there, and a real concurrent insert was observed. The twelve application acceptance scenarios were not executed, because this worktree has no staging application and no payment-provider sandbox. Owner approval to commit or deploy has not been given.

## Reviewed SHA

- Worktree: `C:\projects\finza-web\finza-payment-auth`
- Branch: `fix/prod-payment-authorization`
- HEAD: `ee5cdb2256b59baccf85a598fbc53e083153e53b`
- Production deployment, previously re-checked and not redeployed in this pass: `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH`, READY, newest production deployment of `finza-app`. Source is CLI, so Vercel stores no git SHA. The uploaded baseline for that deployment remains this HEAD.
- Production database, read-only re-check after the staging apply: Finza Pro `qjxhibvbmzogyzbhswjj`. Index `payments_reference_fnz_invoice_unique` absent. Live `FNZ-` rows excluding `FNZ-SUB-`: 0.

## What was reviewed

SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, PAY-001, PAY-002. No other register entries were implemented. Package B was not started.

The payment-security implementation from the previous pass was preserved. This pass added only the ESLint configuration correction, the control-tower `params` type, the staging database test, and these documents.

Public invoice tokens do not expire. Expiry was not added.

## What changed in this pass

- `.eslintrc.json`: the accounting override's bare `no-restricted-imports` pattern string was turned into an object with the same glob and a message. The root rule block was not changed. The glob still applies only to accounting paths.
- `app/accounting/control-tower/[businessId]/page.tsx`: the page is now an async server component, `params` is a `Promise`, and the redirect URL is unchanged.
- Migration 588 was applied to staging project `adonhhtooawkeemdqqeo` only.
- Synthetic staging businesses, invoices, payments, and journals were created for the concurrency test and then deleted.

Package A code stays IMPLEMENTED UNVERIFIED. PAY-002 stays IN PROGRESS because production does not have the index. INF-001 and INF-002 stay CONFIRMED. Nothing was marked VERIFIED, RELEASED, or CLOSED.

## ESLint — INF-002

The failure is in `.eslintrc.json`, in the accounting override, and it is present on HEAD `ee5cdb2`. It predates Package A. ESLint 8.57.1 rejected the override because `patterns` mixed an object with the bare string `"@/!(*accounting|shared)/*"`. That value matches neither the string-array schema nor the object-array schema, so ESLint exited 2 before linting any file.

The correction keeps the same glob and adds the message "Accounting domain can import only from accounting and shared modules". Enforcement of the glob is unchanged. Retail rule sets were not edited. ESLint was not disabled, and no security rule was removed.

| Check | Result |
|---|---|
| Configuration load | Loads. The previous exit 2 schema error is gone. |
| Targeted `npx eslint` on Package A files and the control-tower page | Exit 0. 0 errors. 3 warnings, all in `app/pay/[invoiceId]/page.tsx`: `react-hooks/exhaustive-deps` at lines 95 and 103, `@next/next/no-img-element` at line 566. The pay page was not rewritten. |
| `npm run lint` (`next lint`) | Exit 1. Next.js 16.1.7 treats `lint` as a project directory (`Invalid project directory provided`). ESLint is not invoked. `package.json` was not changed. |

A loaded configuration and a targeted lint with warnings is not a passing repository lint run. INF-002 stays open.

## Production build — INF-001

Installed Next.js is 16.1.7. App Router page `params` must be a `Promise`. The control-tower page is a nine-line server redirect to `/accounting/clients/${businessId}/overview`. It is accounting, not Retail, and it was not part of the original Package A payment diff. The type error is on HEAD and predates Package A. Awaiting `params` does not change the redirect.

`npx next build --webpack` compiled, then failed typecheck on the next pre-existing route: `.next/types/app/api/accounting/afs/[run_id]/finalize/route.ts`. The POST `params` type is a union of `Promise` and a plain object, and that union is not assignable to `Promise`. The control-tower error was gone. The sweep stopped there. The accounting control tower was not redesigned, and no financial calculation was changed.

The same build regenerated `.next/types` and exposed 133 `TS2344` errors of the same `params` class, including accounting, invoice, payroll, proposal, service, and some retail API routes. Those files were not edited. `npx tsc --noEmit` was exit 0 before that webpack build regenerated `.next`. After it, `tsc --noEmit` was exit 2, and every reported error was under `.next/types`. `.next` was left in place. This pass did not re-run `tsc` after that.

`npm run build` was not used. Turbopack previously rejected this worktree's `node_modules` junction.

## Staging isolation

| Check | Result |
|---|---|
| Staging project | `adonhhtooawkeemdqqeo`, Staging Finza, organization `uylkpjekdhckqrdgjbog`, host `db.adonhhtooawkeemdqqeo.supabase.co`, region eu-west-1. Every staging SQL call used this project id. |
| Database name returned by `current_database()` | `postgres`. That is the database name inside the project, not a project id. Identity is the project id on the call. |
| Production project | `qjxhibvbmzogyzbhswjj`. Not used for writes. After the staging apply, a read-only check still showed the index absent and 0 live invoice `FNZ-` rows. |
| This worktree | No Supabase URL and no Paystack secret in its env files. Production secrets were not copied in. |
| Staging application | Not configured. No staging app URL, auth setting, or callback URL was available to execute. |
| Payment provider | No sandbox or mocked Paystack process was configured for HTTP. The concurrency test inserted rows in the staging database. No charge was sent. |
| Credential scope | Staging SQL ran through the staging project connection. The production service role was not used. |
| Migration state before apply | Index `payments_reference_fnz_invoice_unique` absent. Live `FNZ-` excluding `FNZ-SUB-`: 0. Including soft-deleted: 0. Live duplicate groups: 0. Rows matching `finza-mtn-%`, `FZHB%`, or `FNZ-SUB-%`: 0. |
| Test data after cleanup | 0 businesses, 0 invoices, 0 payments, 0 journals, 0 accounts, and 0 audit logs for the synthetic ids. Journal immutability triggers were re-enabled (`tgenabled` O). |

Missing for application acceptance: a staging deployment of this worktree, staging-only Supabase URL and keys for that app, a sandbox or mocked Paystack, and callback URLs that are not production. Those were not created.

## Migration 588 — staging

File: `supabase/migrations/588_paystack_invoice_payment_reference_unique.sql`.

Applied with `apply_migration` on `adonhhtooawkeemdqqeo` only. Name: `paystack_invoice_payment_reference_unique`. Confirmed index definition:

`CREATE UNIQUE INDEX payments_reference_fnz_invoice_unique ON public.payments USING btree (reference) WHERE ((reference IS NOT NULL) AND (deleted_at IS NULL) AND (reference ~~ 'FNZ-%') AND (reference !~~ 'FNZ-SUB-%'))`

| Check | Staging result |
|---|---|
| Null references | Excluded by `reference IS NOT NULL`. |
| Soft-deleted rows | Excluded by `deleted_at IS NULL`. After soft-deleting the winning row, a new insert of the same `FNZ-` reference succeeded. |
| `FNZ-SUB-` | Two inserts of `FNZ-SUB-PKG-A-EXCL` both succeeded. |
| Non-`FNZ-` reference | Two inserts of `PKG-A-NON-FNZ-REF` both succeeded. |
| Uniqueness scope | The index is on `reference` alone, for every tenant. A second tenant's insert of the same `FNZ-` reference failed with `23505`. |
| Ordering | Applied on staging after the zero-row preflight. Not applied on production. |
| Rollback | `DROP INDEX public.payments_reference_fnz_invoice_unique`. Not dropped. The index remains on staging. |

Retail impact of the index: it does not match `finza-mtn-`, `FZHB`, or `FNZ-SUB-`, and the staging inserts proved those exclusions. It would reject a Retail payment only if that payment stored a live `FNZ-` reference that is not `FNZ-SUB-`. Production and staging had zero such rows before the synthetic test. No Retail route was edited. Production apply is still a separate owner decision.

## Concurrent payment test

Environment: staging database `adonhhtooawkeemdqqeo`. Not the application. Not Paystack.

Preconditions: two synthetic businesses, each with accounting bootstrapped and one issued invoice of 10. Invoice insert posted one invoice journal per business. An existing staging user was the owner only so automatic posting could resolve an accountant. Those businesses were deleted afterward.

Method: two overlapping `INSERT` statements into `payments` for invoice A, same reference `FNZ-PKG-A-CONC-20261011`, amount 10, method `cash`. Then a cross-tenant insert, a forced-rollback insert, a soft-delete retry, and the exclusion inserts above.

| Observation | Result |
|---|---|
| First insert | One payment id returned. |
| Second insert, same reference and invoice | `23505` on `payments_reference_fnz_invoice_unique`. This was the database, not a mocked exception. |
| Live rows for that reference immediately after | 1. Payment journals for that business: 1. Invoice journals: 1. |
| Invoice A at that point | Status `paid`. Total 10. Live payments sum 10. |
| Same reference on tenant B | `23505`. No second payment. |
| Insert inside a block that then raised | 0 rows for `FNZ-PKG-A-ROLLBACK-20261011`. Payment journals stayed at 1. |
| Retry of that rolled-back reference | One row inserted. |
| Soft-delete of the first winner, then insert of the same reference | Succeeded. Live rows 1, soft-deleted rows 1. |
| Each successful payment insert | Posted one payment journal through `trigger_auto_post_payment`. The rejected duplicate did not. |

The later exclusion and rollback-retry inserts were extra rows on the synthetic invoices. They were deleted with the fixture. They are not the balance observation. The balance observation is the row above: one live payment of 10 on an invoice of 10, status `paid`, one payment journal.

This does not execute the Paystack verify route. Scenario 8 below stays blocked for that reason.

## Staging acceptance scenarios

Environment for all twelve: not executed. This worktree has no staging app URL, no staging Supabase env for the app, and no Paystack sandbox. No browser or HTTP result is recorded as a pass.

| # | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Authorized invoice payment initialization | A token-matched invoice returns a provider initialization and does not insert a payment before success. | Not executed. | BLOCKED |
| 2 | Unauthorized invoice payment rejection | Missing or receipt-only token is rejected before provider credentials are used. | Not executed. | BLOCKED |
| 3 | Cross-tenant request rejection | A token from one tenant does not settle another tenant. | Not executed. Database-only: the same `FNZ-` reference was rejected on a second synthetic tenant. That is not this scenario. | BLOCKED |
| 4 | Pending payment behavior | Pending provider status inserts no payment and no journal. | Not executed. | BLOCKED |
| 5 | Failed payment behavior | Failed provider status inserts no payment and no journal. | Not executed. | BLOCKED |
| 6 | Successful payment behavior | A verified success settles the matching invoice once. | Not executed. The database insert test is not a provider verification. | BLOCKED |
| 7 | Sequential duplicate verification | A second verify returns the first payment and does not insert again. | Not executed. | BLOCKED |
| 8 | Concurrent duplicate verification | Two simultaneous successful verifications leave one payment and one ledger posting. | Not executed at the route. Staging SQL concurrency is recorded above and is not a pass for this scenario. | BLOCKED |
| 9 | Provider callback replay | A replay does not create a second payment or journal. | Not executed. | BLOCKED |
| 10 | Correct payment-to-invoice relationship | The payment row references the authorized invoice. | Not executed. | BLOCKED |
| 11 | No duplicate accounting effects | One success produces one journal. | Not executed at the route. The SQL race left one payment journal for the duplicate reference. | BLOCKED |
| 12 | Existing Service subscription regression | `FNZ-SUB-` still verifies without an invoice token and does not insert an invoice payment. | Not executed. Staging SQL showed the index allows two `FNZ-SUB-` rows. That is the index predicate, not the subscription route. | BLOCKED |

Local Jest covers the mocked forms of 1–7 and 12. Those tests are not staging acceptance.

## Regression tests

| Check | Result |
|---|---|
| Package A Jest | Exit 0. 15 suites, 78 tests. Pattern `paystack\|invoicePayCapability\|hubtelInvoiceToken\|momo/tenant/invoice\|mtnCallbackHint\|mtnInvoiceDirectService`. No live charge. |
| TypeScript before the webpack type regeneration | Exit 0, earlier this day. |
| TypeScript after `npx next build --webpack` regenerated `.next` | Exit 2. 133 errors, all under `.next/types`. Not re-run in this continuation. |
| ESLint targeted | Exit 0, 0 errors, 3 warnings. |
| `npm run lint` | Exit 1. ESLint not invoked. |
| Production webpack build | Exit 1. Control-tower error gone. Next failure: `app/api/accounting/afs/[run_id]/finalize/route.ts`. |
| Payment capability, settlement, binding, tenant isolation | Included in the 78 Jest tests. Providers and the database are mocked. |
| Migration 588 | Applied on staging. Absent on production. |
| Public invoice links, platform subscriptions, pending, failed, and repeated verification over HTTP | Not executed on staging. |

## Retail impact

Retail was not modified.

`git diff` against HEAD is empty for `components/retail`, `app/(dashboard)/pos`, `lib/retail`, and `app/api/payments/momo/route.ts`.

The staging index does not cover Retail `finza-mtn-` or Hubtel `FZHB` references. Two identical non-`FNZ-` references were inserted on staging and then deleted. Shared `payments` still means a future Retail writer that stores a live `FNZ-` reference other than `FNZ-SUB-` would hit this index. No current Retail route in this diff does that.

## Changed-file inventory

This pass, relative to the previous Package A working tree:

- `.eslintrc.json`
- `app/accounting/control-tower/[businessId]/page.tsx`
- `docs/remediation/service/PACKAGE_A_ACCEPTANCE_REPORT.md`
- `docs/remediation/service/MASTER_DEFECT_REGISTER.md`
- `docs/remediation/service/STATUS.md`
- `docs/remediation/service/RELEASE_PLAN.md`
- `docs/remediation/service/RELEASE_GATES.md`

Already present and preserved:

Modified tracked payment files:

- `app/api/payments/momo/status/route.ts`
- `app/api/payments/momo/tenant/invoice/initiate/route.ts`
- `app/api/payments/momo/tenant/invoice/status/route.ts`
- `app/api/payments/paystack/charge/route.ts`
- `app/api/payments/paystack/submit-otp/route.ts`
- `app/api/payments/paystack/verify/route.ts`
- `app/pay/[invoiceId]/page.tsx`
- `lib/tenantPayments/__tests__/mtnCallbackHint.test.ts`
- `lib/tenantPayments/__tests__/mtnInvoiceDirectService.test.ts`
- `lib/tenantPayments/hubtelInvoiceDirectService.ts`
- `lib/tenantPayments/mtnInvoiceDirectService.ts`

Untracked implementation and tests:

- `lib/payments/invoicePayCapability.ts`
- `lib/payments/paystackInvoiceSettlement.ts`
- `lib/payments/paystackInvoiceBinding.ts`
- `lib/payments/__tests__/invoicePayCapability.test.ts`
- `lib/payments/__tests__/paystackInvoiceSettlement.test.ts`
- `lib/payments/__tests__/paystackInvoiceBinding.test.ts`
- `app/api/payments/paystack/charge/__tests__/route.test.ts`
- `app/api/payments/paystack/verify/__tests__/route.test.ts`
- `app/api/payments/paystack/submit-otp/__tests__/route.test.ts`
- `app/api/payments/momo/tenant/invoice/initiate/__tests__/route.test.ts`
- `app/api/payments/momo/tenant/invoice/status/__tests__/route.test.ts`
- `lib/tenantPayments/__tests__/hubtelInvoiceToken.test.ts`
- `supabase/migrations/588_paystack_invoice_payment_reference_unique.sql`

`package.json` was not modified.

## Remaining blockers

- No staging application, so scenarios 1–12 have no execution evidence.
- Production build still fails on `app/api/accounting/afs/[run_id]/finalize/route.ts`, and the same `params` class exists on many other routes. Those were not changed.
- `npm run lint` does not run ESLint on Next.js 16.1.7. Targeted lint has 3 warnings.
- Migration 588 is on staging only. Production apply has not been approved.
- The concurrent test was SQL, not two Paystack verify requests.
- No commit, and no owner approval to commit, push, or deploy.
- Last `tsc --noEmit` after the webpack build is exit 2 because of generated `.next/types`.

## Production release prerequisites

1. Owner accepts the Service payment diff, the ESLint correction, and the control-tower type change.
2. A fresh read-only duplicate check on production, then apply 588 there, then deploy the settlement code. That apply is not authorized by this report.
3. A staging application of this branch, with sandbox or mocked Paystack, runs scenarios 1–12.
4. The production build completes, or the owner accepts a written exception for the remaining `params` routes.
5. No Retail diff.

## Next action

Wait for the owner. Do not start Package B. Do not apply 588 to production. Do not deploy.

## Confirmations

- Retail was not modified.
- Production data was not modified. The Finza Pro queries were read-only.
- Production migrations were not applied.
- No production deployment occurred.
- No merge or push occurred.
- No commit was created.
