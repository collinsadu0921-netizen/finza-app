# Platform compatibility audit

Status date: 11 October 2026. Assessment only. No application code, tests, package files, or deployments were changed by this audit.

## Verdict

The production webpack build and `npm run lint` fail for platform reasons that are already on HEAD `ee5cdb2`. They are not caused by the Package A payment changes. Package A stays NOT READY. This document does not authorize the correction.

## 1. Root cause

Installed and lockfile Next.js are both 16.1.7. Next.js 16 generates a route checker that requires dynamic `params` to be `Promise<SegmentParams>`. `tsconfig.json` includes `.next/types/**/*.ts`, so `tsc --noEmit` stays quiet until a production build writes those files, and then reports the same errors.

99 source files still type `params` as `Promise<...> | { ... }`. `await Promise.resolve(params)` accepts both shapes at runtime. The generated checker does not. A union that still includes a plain object fails `ParamCheck<RouteContext>` with `TS2344`. One source file produces one error per exported HTTP method, so 99 files produce 133 generated errors. The errors are duplicates of one source pattern, not 133 independent defects.

`app/accounting/control-tower/[businessId]/page.tsx` was a plain-object page on HEAD. The Package A worktree already awaits `Promise` params and redirects to the same client overview. That file is absent from the 133-error log. The next failure, `app/api/accounting/afs/[run_id]/finalize/route.ts`, is the same union pattern. Spot checks of that route and `app/api/retail/expenses/[id]/route.ts` show `await Promise.resolve(params)` before any authorization decision.

This union is on the production source baseline. It was not introduced by Package A. `next.config.js` does not set `typescript.ignoreBuildErrors` or `eslint.ignoreDuringBuilds`.

An existing branch `fix/next16-dynamic-params` at `61a4ed6` contains commit `d6bbc2b` (`fix(next): align dynamic params with Next 16`), which narrows about 100 signatures to `Promise` only. That branch is 128 commits and 619 files away from `ee5cdb2`, including Retail, OCR, and migrations. Do not merge it. A future compatibility branch should start at `ee5cdb2` and apply only the signature narrowing.

Why the live production deployment is still READY is not fully proven. `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` is a CLI upload with empty git metadata. The release workflow runs `npm run build`, which would typecheck. This audit did not download that deployment's build log. Treat the local failure as the current source result, and reproduce it in a clean worktree before editing routes.

## 2. Affected source files

133 generated `TS2344` errors. 99 source files. Every one is pattern B, the Promise-or-object union. Zero files in the error log are plain-object-only, and zero are Promise-only.

The control-tower page is a 100th source file already corrected in this worktree. It is not in the error log.

| Class | Source files | Generated errors |
|---|---:|---:|
| Service-only | 59 | 72 |
| Shared operational | 28 | 47 |
| Accounting-only | 11 | 13 |
| Retail-only | 1 | 1 |
| Total in the error log | 99 | 133 |

Shared operational is the set the mechanical classifier marked Unknown: bills, expenses, assets, staff, reconciliation, proforma, VAT, the public invoice route, and `app/api/users/[id]/store/route.ts`. Those screens are not Retail-only, and they are not inside `app/service`. `users/[id]/store` may be store-scoped and should be reviewed with the Retail file.

### Retail-only

| Errors | File |
|---:|---|
| 1 | `app/api/retail/expenses/[id]/route.ts` |

This file is out of Package A. A type-only edit still needs owner authorization. Leaving it unchanged keeps the production build red.

### Accounting-only

| Errors | File |
|---:|---|
| 1 | `app/api/accounting/afs/[run_id]/finalize/route.ts` |
| 1 | `app/api/accounting/afs/documents/[run_id]/route.ts` |
| 1 | `app/api/accounting/afs/runs/[id]/export/csv/route.ts` |
| 1 | `app/api/accounting/afs/runs/[id]/export/json/route.ts` |
| 1 | `app/api/accounting/afs/runs/[id]/export/pdf/route.ts` |
| 1 | `app/api/accounting/afs/runs/[id]/route.ts` |
| 2 | `app/api/accounting/firm/engagements/[id]/route.ts` |
| 1 | `app/api/accounting/firm/engagements/[id]/status/route.ts` |
| 1 | `app/api/accounting/opening-balances/[id]/approve/route.ts` |
| 1 | `app/api/accounting/opening-balances/[id]/post/route.ts` |
| 2 | `app/api/accounting/opening-balances/[id]/route.ts` |

### Service-only

| Errors | File |
|---:|---|
| 1 | `app/api/credit-notes/[id]/pdf/route.ts` |
| 1 | `app/api/credit-notes/[id]/pdf-preview/route.ts` |
| 2 | `app/api/credit-notes/[id]/route.ts` |
| 1 | `app/api/credit-notes/[id]/send/route.ts` |
| 1 | `app/api/estimates/[id]/accept/route.ts` |
| 1 | `app/api/estimates/[id]/export-pdf/route.ts` |
| 1 | `app/api/estimates/[id]/pdf-preview/route.ts` |
| 1 | `app/api/estimates/[id]/reject/route.ts` |
| 2 | `app/api/estimates/[id]/route.ts` |
| 1 | `app/api/estimates/[id]/send/route.ts` |
| 1 | `app/api/gra/evat/invoices/[invoiceId]/draft/route.ts` |
| 1 | `app/api/invoices/[id]/approval/route.ts` |
| 1 | `app/api/invoices/[id]/credit-capacity/route.ts` |
| 1 | `app/api/invoices/[id]/export-pdf/route.ts` |
| 1 | `app/api/invoices/[id]/pdf/route.ts` |
| 1 | `app/api/invoices/[id]/pdf-preview/route.ts` |
| 3 | `app/api/invoices/[id]/route.ts` |
| 1 | `app/api/invoices/[id]/send/route.ts` |
| 1 | `app/api/invoices/public/[token]/pdf/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/gra-dt107a-paye/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/net-salary/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/obligations/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/paye-schedule/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/pension-tier1/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/pension-tier2/route.ts` |
| 1 | `app/api/payroll/runs/[id]/exports/summary/route.ts` |
| 1 | `app/api/payroll/runs/[id]/obligations/[obligationId]/payments/route.ts` |
| 1 | `app/api/payroll/runs/[id]/obligations/generate/route.ts` |
| 1 | `app/api/payroll/runs/[id]/obligations/route.ts` |
| 1 | `app/api/payroll/runs/[id]/payment-batches/[batchId]/export/route.ts` |
| 1 | `app/api/payroll/runs/[id]/payment-batches/[batchId]/items/[itemId]/record-payment/route.ts` |
| 1 | `app/api/payroll/runs/[id]/payment-batches/[batchId]/items/[itemId]/route.ts` |
| 2 | `app/api/payroll/runs/[id]/payment-batches/[batchId]/route.ts` |
| 2 | `app/api/payroll/runs/[id]/payment-batches/route.ts` |
| 2 | `app/api/payroll/runs/[id]/payments/route.ts` |
| 1 | `app/api/payroll/runs/[id]/reverse/route.ts` |
| 3 | `app/api/payroll/runs/[id]/route.ts` |
| 2 | `app/api/proposals/[id]/assets/[assetId]/route.ts` |
| 1 | `app/api/proposals/[id]/assets/route.ts` |
| 1 | `app/api/proposals/[id]/assets/upload/route.ts` |
| 1 | `app/api/proposals/[id]/convert-estimate/route.ts` |
| 1 | `app/api/proposals/[id]/export-pdf/route.ts` |
| 3 | `app/api/proposals/[id]/route.ts` |
| 1 | `app/api/proposals/[id]/send/route.ts` |
| 1 | `app/api/proposals/public/[token]/accept/route.ts` |
| 1 | `app/api/proposals/public/[token]/assets/[assetId]/route.ts` |
| 1 | `app/api/proposals/public/[token]/pdf/route.ts` |
| 1 | `app/api/proposals/public/[token]/reject/route.ts` |
| 1 | `app/api/proposals/public/[token]/route.ts` |
| 1 | `app/api/service/engagements/[id]/route.ts` |
| 1 | `app/api/service/jobs/[id]/cancel/route.ts` |
| 1 | `app/api/service/jobs/[id]/material-cost/route.ts` |
| 1 | `app/api/service/jobs/[id]/route.ts` |
| 1 | `app/api/service/jobs/[id]/workspace/route.ts` |
| 1 | `app/api/service/materials/inventory/[id]/add-stock/route.ts` |
| 1 | `app/api/service/materials/inventory/[id]/adjust/route.ts` |
| 1 | `app/api/service/materials/inventory/[id]/movements/route.ts` |
| 2 | `app/api/service/materials/inventory/[id]/route.ts` |
| 1 | `app/api/service/materials/inventory/[id]/use-stock/route.ts` |

### Shared operational

| Errors | File |
|---:|---|
| 1 | `app/api/assets/[id]/depreciation/reverse/route.ts` |
| 3 | `app/api/assets/[id]/depreciation/route.ts` |
| 1 | `app/api/assets/[id]/dispose/route.ts` |
| 3 | `app/api/assets/[id]/route.ts` |
| 2 | `app/api/bills/[id]/payments/[paymentId]/route.ts` |
| 2 | `app/api/bills/[id]/payments/route.ts` |
| 3 | `app/api/bills/[id]/route.ts` |
| 2 | `app/api/expense-categories/[id]/route.ts` |
| 3 | `app/api/expenses/[id]/route.ts` |
| 1 | `app/api/proforma/[id]/accept/route.ts` |
| 1 | `app/api/proforma/[id]/convert-to-invoice/route.ts` |
| 1 | `app/api/proforma/[id]/export-pdf/route.ts` |
| 2 | `app/api/proforma/[id]/route.ts` |
| 1 | `app/api/proforma/[id]/send/route.ts` |
| 1 | `app/api/public/invoice/[id]/route.ts` |
| 1 | `app/api/reconciliation/[accountId]/import/route.ts` |
| 1 | `app/api/reconciliation/[accountId]/transactions/route.ts` |
| 2 | `app/api/staff/[id]/allowances/[allowanceId]/route.ts` |
| 1 | `app/api/staff/[id]/allowances/route.ts` |
| 2 | `app/api/staff/[id]/deductions/[deductionId]/route.ts` |
| 1 | `app/api/staff/[id]/deductions/route.ts` |
| 2 | `app/api/staff/[id]/payment-methods/[methodId]/route.ts` |
| 2 | `app/api/staff/[id]/payment-methods/route.ts` |
| 3 | `app/api/staff/[id]/route.ts` |
| 1 | `app/api/suppliers/statement/[name]/route.ts` |
| 1 | `app/api/users/[id]/store/route.ts` |
| 1 | `app/api/vat-returns/[id]/export/pdf/route.ts` |
| 2 | `app/api/vat-returns/[id]/route.ts` |

## 3. Generated-error grouping

| Group | Meaning | Count |
|---|---|---:|
| Source pattern | `params: Promise<...> \| { ... }` | 99 files |
| Generated diagnostic | One `TS2344` per exported method whose second argument is not exactly `Promise` | 133 errors |
| Already corrected in this worktree | Control-tower page, Promise only | Not in the log |
| Separate product defect | None identified in this log | 0 |

There is no second root cause in the captured log. All 133 lines are `TS2344` on `params`.

## 4. Dependency and configuration

| Item | Value |
|---|---|
| Next.js lockfile and install | 16.1.7 |
| React / React DOM | 18.3.1 |
| ESLint | 8.57.1 |
| eslint-config-next | 14.2.33 |
| TypeScript | `^5.0.0` in package.json. Exact install was not required for this diagnosis. |
| Node on this machine | 24.12.0 |
| npm | 11.7.0 |
| Vercel project Node | 24.x |
| Production release workflow Node | 20.x |
| Package manager | npm. `package-lock.json` is present and unmodified. |
| `node_modules` in the Package A worktree | Junction to `C:\projects\finza-web\finza-web\node_modules`. Versions match the lockfile. A clean reproduction should still use `npm ci` in its own directory. |
| Lint script | `"lint": "next lint"` |
| CI lint / tsc | No workflow step matches lint, tsc, or eslint. `production-release.yml` runs `npm ci`, one Jest guard, then `npm run build`. |
| Build ignore flags | None |

`eslint-config-next` 14 is two majors behind Next.js 16. Targeted ESLint already runs with the current config. Upgrading that package is not required to make the lint script invoke ESLint, and it can add new failures. Do it only as a later, separate change.

Node 20 in GitHub Actions versus Node 24 on Vercel and on this machine is configuration drift. It did not cause the `params` errors. Do not change the workflow Node version inside the route-type fix unless a clean build shows a Node-specific failure.

## 5. Lint

`npm run lint` runs `next lint`. Next.js 16.1.7 no longer has a lint command. The CLI treats `lint` as a project directory and exits 1 with `Invalid project directory provided`. ESLint is never started.

The accounting `no-restricted-imports` schema error was corrected earlier in this worktree. Targeted `npx eslint` on the Package A files then exited 0 with 0 errors and 3 warnings in `app/pay/[invoiceId]/page.tsx`. Those warnings are not the script failure.

Smallest correction, not applied here: change the lint script to invoke ESLint directly, for example `eslint .`, using the existing `.eslintrc.json`. Do not add `--max-warnings 0` in that first change, or the three existing warnings become a new gate failure. Do not disable rules. Do not upgrade `eslint-config-next` in the same change.

Direct ESLint is compatible with the installed ESLint 8.57.1 config. The script is the broken entry point.

CI will still not lint until a workflow step is added. That is a follow-up, not the smallest script fix. The production release job will keep failing at `npm run build` until the route types are narrowed, even after lint is restored.

## 6. Correction pattern

For each affected handler:

1. Change `params` to `Promise<...>` only.
2. Keep `await Promise.resolve(params)` or use `await params`.
3. Do not move, weaken, or reorder the authorization checks that follow.
4. Do not change financial calculations, Retail expense rules, or Package A payment behavior.

Runtime risk is low when the handler already awaits `Promise.resolve(params)`, which the two spot checks do. A handler that reads `params.id` without awaiting would break if the type is narrowed and the body is not updated. The implementation pass must confirm every edited handler still awaits `params` before use.

Authentication risk is low if the await stays where it is. The Retail expense route resolves `params`, then loads the user, then applies `gateRetailExpenseBusiness` and `assertRetailExpenseAction`. That order must remain.

`d6bbc2b` is evidence that the narrowing is mechanical. It is not a patch that can be merged from `fix/next16-dynamic-params`.

Proposed branch, not created: `fix/next16-route-params`, from `ee5cdb2256b59baccf85a598fbc53e083153e53b`, in a new worktree. Do not use the Package A worktree for that edit. The Retail file stays in a separate commit, or the whole compatibility branch waits for owner approval of that one Retail file. A green build needs the Retail file included.

## 7. Regression coverage

Route tests under `app/**/__tests__` : 113 files. `app/**/*.test.ts`: 110 files. 27 of those `.test.ts` files mention `params: Promise`. That is coverage of some handlers, not proof that all 99 signatures are tested.

Required after the correction, in a clean worktree with its own `node_modules`:

1. `npm ci`
2. `npx tsc --noEmit` before a build, then again after `npm run build` has written `.next/types`
3. `npx eslint .` and `npm run lint` after the script change
4. Package A Jest pattern, unchanged
5. One existing route test from each class: accounting AFS, service invoice, shared bills or expenses, and the Retail expense route if the owner authorizes that file
6. `npm run build` using the lockfile Next.js, not `next build --webpack` unless the clean install still needs it

No new payment tests belong in the compatibility change.

## 8. Retail boundary

Retail routes, POS, and `lib/retail` have no diff in the Package A worktree. The compatibility inventory adds one Retail source file: `app/api/retail/expenses/[id]/route.ts`. `app/api/users/[id]/store/route.ts` needs a Retail review because the name is store-scoped.

Do not put either file into the Package A payment commit. Do not copy the 128-commit Next 16 branch.

## 9. Sequence and complexity

| Workstream | What | Complexity |
|---|---|---|
| A | New branch from `ee5cdb2`. Narrow the 99 unions. Keep awaits. Exclude Package A payment edits. | Mechanical, wide diff, low behavioral risk if awaits stay |
| B | Owner decision on the one Retail route, and a look at `users/[id]/store` | Small, blocks a fully green build |
| C | Point `npm run lint` at ESLint. Leave warnings as warnings. | One script line |
| D | Clean-worktree `npm ci`, tsc, eslint, Jest, `npm run build` | Environment, because this worktree's `node_modules` is a junction |
| E | Optional later: align `eslint-config-next` with Next 16, and add lint to CI | Separate. Can create new lint findings |

No dates.

## 10. Acceptance criteria

- `npm run build` completes on a clean install of this lockfile.
- `npx tsc --noEmit` exits 0 after `.next/types` exists.
- `npm run lint` invokes ESLint and exits 0 on errors. Existing warnings are recorded.
- Diff against `ee5cdb2` for this branch is signature and lint-script only, plus the already-understood control-tower page if that commit is included.
- No payment-route behavior change.
- Retail file either absent, with the build still red and that exception written down, or present with owner approval and an unchanged expense authorization sequence.
- Package A payment diff is not mixed into this branch until the owner says to combine them.

## Reproduction

Do not reuse the Package A junction for the clean run.

```
git worktree add ../finza-platform-compat ee5cdb2256b59baccf85a598fbc53e083153e53b
cd ../finza-platform-compat
npm ci
npx tsc --noEmit
npx eslint .
npm run lint
npm run build
npx tsc --noEmit
```

`npx tsc --noEmit` before the build can pass because `.next/types` is absent. The second `tsc` is the one that matches the 133 errors. `npm run lint` fails until the script is changed. `npx eslint .` is the direct check. This audit did not run `npm ci` or delete `.next`.

The captured error log used by this inventory is the webpack build's typecheck output from the Package A worktree on 11 October 2026.
