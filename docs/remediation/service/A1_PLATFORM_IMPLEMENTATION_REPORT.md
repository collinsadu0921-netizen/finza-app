# A1 platform implementation report

Status date: 11 October 2026. Compatibility implementation only. Nothing was committed, pushed, merged, or deployed. Package A's worktree was not edited. No database was changed.

## Starting point

| Item | Value |
|---|---|
| Production source | `ee5cdb2256b59baccf85a598fbc53e083153e53b` |
| Branch | `fix/next16-build-compatibility` |
| Worktree | `C:\projects\finza-web\finza-next16-build-compat` |
| Base | That SHA directly. Not `fix/next16-dynamic-params`. |
| Dependencies | `npm ci` in this worktree. Exit 0. `node_modules` is a real directory, not a junction. Next.js 16.1.7, ESLint 8.57.1, eslint-config-next 14.2.33. |
| Payment-security worktree | `C:\projects\finza-web\finza-payment-auth` remains on `fix/prod-payment-authorization` at the same SHA, with its existing uncommitted payment files. |

## What changed

100 route signatures, plus two config files.

99 route files had `params` typed as `Promise<T> | T` with both arms the same object type. Each arm was removed in favor of `Promise<T>`. Parameter names and the existing `await Promise.resolve(params)` lines were left in place. Two payroll batch-item routes used a multiline union. Those collapsed to one `params: Promise<...>` line. The `await Promise.resolve(params)` line under them is unchanged.

`app/accounting/control-tower/[businessId]/page.tsx` was a plain object on this baseline, so it was not in the earlier 133-error log taken after the payment worktree had already corrected it. It is the same Next.js 16 defect. The page is now async, `params` is `Promise<{ businessId: string }>`, and it still redirects to `/accounting/clients/${businessId}/overview`.

`app/api/users/[id]/store/route.ts` was inspected before editing. It is a shared user route: it imports shared auth helpers, has no industry gate, and has no caller under `app` or `components`. It updates `users.store_id` after an owner or admin check. The type-only narrowing was applied. Permission checks and the store query were not changed. It is not an expansion of the Retail exception.

The approved Retail file `app/api/retail/expenses/[id]/route.ts` changed only from `Promise<{ id: string }> | { id: string }` to `Promise<{ id: string }>`. `await Promise.resolve(params)`, `gateRetailExpenseBusiness`, and `assertRetailExpenseAction` are unchanged. No other Retail file was edited.

`.eslintrc.json` received only the accounting override correction already reviewed on the payment branch: the bare pattern string is now an object with the same glob and a message. Root rules were not changed.

`package.json` lint script changed from `next lint` to `eslint . --ignore-pattern .next`. `--ignore-pattern .next` keeps generated build types out of lint. No rule was disabled. ESLint and `eslint-config-next` were not upgraded. The lockfile was not changed.

No payment-security route, migration, financial calculation, or authorization helper was edited. Files whose paths contain `payments` in this diff are bill and payroll routes. Their diffs are the same `params` narrowing.

## Changed-file inventory

102 files. 142 insertions, 142 deletions. Not committed.

Config:

- `.eslintrc.json`
- `package.json`

Accounting page:

- `app/accounting/control-tower/[businessId]/page.tsx`

Accounting routes (11):

- `app/api/accounting/afs/[run_id]/finalize/route.ts`
- `app/api/accounting/afs/documents/[run_id]/route.ts`
- `app/api/accounting/afs/runs/[id]/export/csv/route.ts`
- `app/api/accounting/afs/runs/[id]/export/json/route.ts`
- `app/api/accounting/afs/runs/[id]/export/pdf/route.ts`
- `app/api/accounting/afs/runs/[id]/route.ts`
- `app/api/accounting/firm/engagements/[id]/route.ts`
- `app/api/accounting/firm/engagements/[id]/status/route.ts`
- `app/api/accounting/opening-balances/[id]/approve/route.ts`
- `app/api/accounting/opening-balances/[id]/post/route.ts`
- `app/api/accounting/opening-balances/[id]/route.ts`

Retail (1, type only):

- `app/api/retail/expenses/[id]/route.ts`

Shared operational, including the user store route (28):

- `app/api/assets/[id]/depreciation/reverse/route.ts`
- `app/api/assets/[id]/depreciation/route.ts`
- `app/api/assets/[id]/dispose/route.ts`
- `app/api/assets/[id]/route.ts`
- `app/api/bills/[id]/payments/[paymentId]/route.ts`
- `app/api/bills/[id]/payments/route.ts`
- `app/api/bills/[id]/route.ts`
- `app/api/expense-categories/[id]/route.ts`
- `app/api/expenses/[id]/route.ts`
- `app/api/proforma/[id]/accept/route.ts`
- `app/api/proforma/[id]/convert-to-invoice/route.ts`
- `app/api/proforma/[id]/export-pdf/route.ts`
- `app/api/proforma/[id]/route.ts`
- `app/api/proforma/[id]/send/route.ts`
- `app/api/public/invoice/[id]/route.ts`
- `app/api/reconciliation/[accountId]/import/route.ts`
- `app/api/reconciliation/[accountId]/transactions/route.ts`
- `app/api/staff/[id]/allowances/[allowanceId]/route.ts`
- `app/api/staff/[id]/allowances/route.ts`
- `app/api/staff/[id]/deductions/[deductionId]/route.ts`
- `app/api/staff/[id]/deductions/route.ts`
- `app/api/staff/[id]/payment-methods/[methodId]/route.ts`
- `app/api/staff/[id]/payment-methods/route.ts`
- `app/api/staff/[id]/route.ts`
- `app/api/suppliers/statement/[name]/route.ts`
- `app/api/users/[id]/store/route.ts`
- `app/api/vat-returns/[id]/export/pdf/route.ts`
- `app/api/vat-returns/[id]/route.ts`

Service routes (59): credit notes, estimates, the GRA e-VAT invoice draft, invoices, payroll runs, proposals, service engagements, service jobs, and service material inventory. The diff stat lists each path. None of those files are Paystack, tenant MoMo, or Hubtel payment routes.

## Errors resolved

The 133 `TS2344` generated `params` errors came from the 99 union files. Those unions are gone. `npx tsc --noEmit` after `npx next build --webpack` wrote `.next/types` exited 0. That is the check that previously failed when `.next/types` existed.

Helper functions that happen to take an argument named `params` were not route props and were not edited.

## Validation

| Command | Exit | Result |
|---|---:|---|
| `npm ci` | 0 | Clean install in this worktree. |
| `npx eslint` on the 100 changed source files | 0 | 0 errors, 0 warnings. |
| `npm run lint` | 1 | ESLint runs. 88 errors and 181 warnings in files this change did not touch. First errors are `react/no-unescaped-entities` and `no-alert` on accounting and admin pages. Rules were not disabled. |
| `npx tsc --noEmit` before the build | 0 | Passed. `.next/types` was not required for this pass. |
| `npx next build --webpack` | 1 | Compiled in about 3.9 minutes. No type error. Failed later while collecting page data for `/api/expenses/categories` because the Supabase URL and API key are absent in this clean worktree. |
| `npx tsc --noEmit` after that build | 0 | `.next/types` was present. 0 errors. |
| Retail expense tests | — | No test path contains both retail and expense. |
| Jest on this branch for `payments\|paystack\|momo\|hubtel` | 1 | 27 suites passed, 2 failed. 146 tests passed, 8 failed. Failures are `mtnCallbackHint.test.ts` (mock has no `.in`) and `app/api/payments/__tests__/create.test.ts` (mock `select` is not a function). Those files are not in this diff. |
| Package A Jest in `finza-payment-auth`, not modified | 0 | 15 suites, 78 tests. HEAD unchanged. |

## Retail impact

One Retail file, type only: `app/api/retail/expenses/[id]/route.ts`. The permission sequence is unchanged. No POS, Retail payment, inventory, stock, or other Retail route was edited. `components/retail`, `app/(dashboard)/pos`, and `lib/retail` have no diff.

## Remaining blockers

- `npm run lint` is not green. The script now invokes ESLint, and the repository has 88 pre-existing errors. Fixing them is outside this assignment.
- `npx next build --webpack` is not green in this clean worktree because Supabase env is missing at page-data collection. That is not a route-type failure. Production secrets were not copied in.
- Baseline payment Jest failures on this SHA are pre-existing. The uncommitted Package A tests that cover the corrected mocks live only in the payment worktree.
- This branch is not committed and is not integrated with Package A.
- Staging readiness is a separate assignment.

## Integration with Package A

Keep this branch separate from `fix/prod-payment-authorization`.

After owner review, apply this branch's signature and lint changes onto the payment branch, or rebase the payment work onto this branch. The payment worktree already contains the same control-tower page and the same ESLint accounting pattern, so those two files will match. The 99 route files are not part of the payment diff, so they should apply without touching Paystack, tenant MoMo, or Hubtel.

Do not merge `fix/next16-dynamic-params`. Do not deploy this branch. Do not apply migration 588 from this worktree. It is not in the diff.

## Git status

Branch `fix/next16-build-compatibility` at `ee5cdb2256b59baccf85a598fbc53e083153e53b`, with 102 uncommitted tracked files as listed above, plus this untracked report. No commit, push, or merge.

`finza-payment-auth` HEAD is still `ee5cdb2256b59baccf85a598fbc53e083153e53b`. Its previous uncommitted payment files were left as they were.
