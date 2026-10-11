# Staging readiness audit

Status date: 11 October 2026. Read-only. No environment variable, deployment, migration, or database row was changed. Secret values were not printed and are not recorded here.

Staging is not READY. The staging database exists and migration 588 is present there. There is no staging application of Package A, no verified staging URL, and no sandbox payment configuration that this audit could prove is isolated from production.

## 1. Infrastructure inventory

| Piece | Identity | State |
|---|---|---|
| Vercel project | `finza-app`, `prj_BxbfIgXTl1PAX6W3635Nsc8KXuW1`, team `team_oWPGv9x9bpRD2nRmUM2lKpzJ` | Present |
| Framework / Node | Next.js, Node 24.x | Present |
| Production domains | `app.finza.africa`, `finza-app.vercel.app`, `finza-app-collins-projects-f49524b8.vercel.app` | Production |
| Dedicated staging domain | None on the project domain list | MISSING |
| Production deployment | `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH`, READY, CLI source, empty git metadata | Current production |
| Newest preview of branch `staging` | `dpl_57HkjdsRurY9cha7hmsNbHQg5hCs`, READY, SHA `45d8be86fe67ad008b76a0411ffc265eaa196b04` | Not Package A and not `ee5cdb2` |
| Git production auto-deploy of `main` | Disabled in `vercel.json` | Present |
| Region and crons | `arn1`. Crons: accounting snapshots 02:00, service subscription lifecycle 08:00, trial growth 09:00 | Production project config |
| Deployment protection | Vercel SSO on all deployments except custom domains | Preview URLs are protected. `app.finza.africa` is not. |
| Staging Supabase | `adonhhtooawkeemdqqeo`, host `db.adonhhtooawkeemdqqeo.supabase.co` | Present. `current_database()` is `postgres`. |
| Production Supabase | `qjxhibvbmzogyzbhswjj`, guarded in `scripts/lib/productionReleaseGuards.cjs` | Present |
| Local staging template | `docs/staging/setup.md`, `.env.staging.example` | Present and partly stale |
| Package A worktree env | No Supabase URL and no Paystack secret configured for the app | MISSING |

Other Vercel projects found and not used: `finzamarketing`, `finza-app-perf-arn`, `finza-app-perf-eu`.

`origin/staging` is `45d8be8`. `origin/main` is `ee5cdb2`. They are not the same commit. A preview of `staging` does not contain the production overdue commit or Package A.

## 2. What staging can already do

| Capability | Classification | Evidence |
|---|---|---|
| Separate Supabase project | READY | Project id checked. Not the production id. |
| Migration 588 on that database | READY | See section 6. |
| Synthetic Package A rows removed | READY | Counts are zero. See section 7. |
| Journal immutability triggers enabled | READY | Both triggers enabled. Definitions were not replaced. |
| Branch-scoped preview env slots for git branch `staging` | UNVERIFIED | Names exist. Values were not decrypted, so the URL host was not confirmed. |
| Preview deployment of `staging` | MISCONFIGURED for Package A | READY deployment is an older SHA, with no stable staging hostname found. |
| Paystack sandbox on preview | MISSING | Paystack keys are production-scoped only. |
| Package A HTTP acceptance | BLOCKED | No app URL for this branch, no sandbox keys, preview SSO. |

`docs/staging/setup.md` still says to create a Supabase project and apply migrations through 496. The live staging project is past that, including 588. Do not follow the old migration ceiling.

## 3. Environment names

69 environment rows, 41 names. Counts of unique keys: 11 production-only, 10 preview-only, 0 development-only, 20 shared across targets. Values were not read.

Production-only names include `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED`, the Hubtel checkout and status names, and `TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY`.

Git branch `staging` has its own rows for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. Those rows are not the production rows. This audit did not decrypt them, so it does not claim they point at `adonhhtooawkeemdqqeo`.

`fix/prod-payment-authorization` has no branch-scoped Supabase or Paystack rows. A preview of Package A would not inherit the `staging` branch overrides. There is also no unscoped preview `NEXT_PUBLIC_SUPABASE_URL`. That preview would be MISSING its database URL unless a new branch scope is added.

Several other branches have their own preview Supabase URL and service-role rows: `feat/staging-openai-receipt`, `fix/dashboard-period-selection`, `fix/retail-shop1-launch-blockers`, `fix/service-invoice-overdue-consistency`, `fix/service-invoice-quote-consistency`, and `release/prod-browser-receipt-ocr`. Those are not Package A.

## 4. Production isolation

| Check | Result |
|---|---|
| Database identity | Staging and production project ids differ. SQL in this audit used the staging id for staging reads and the production id for a read-only index check. |
| Service-role scope | Separate env rows exist for production and for preview branch `staging`. The key material was not compared. UNVERIFIED. |
| Auth project | Not visible without decrypting `NEXT_PUBLIC_SUPABASE_URL` or opening the Supabase auth dashboard. UNVERIFIED. |
| Storage buckets | Not inspected. UNVERIFIED. |
| Callbacks | No `app/api` file hardcodes `app.finza.africa` or `supabase.co`. Eighteen other files mention `app.finza.africa`. `NEXT_PUBLIC_APP_URL` has separate preview and production rows. Whether the preview value is `app.finza.africa` was not decrypted. UNVERIFIED. |
| Webhooks | Routes exist for Paystack verify, Hubtel callback, MoMo callback, mobile-money webhook, Resend, and WhatsApp. Paystack keys are not on preview. Resend keys are shared. |
| Scheduled jobs | Crons are on the Vercel project and are part of the production release guard. They invoke the production deployment, not a preview. A mistaken production deploy would run them. |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`, and `RESEND_Re_KE` are on one row targeted at preview and production. A preview can send with the production email credential. MISCONFIGURED. |
| AI keys | `GROQ_API_KEY` is on development, preview, and production. `OPENAI_API_KEY` has a shared preview+production row plus a branch override. Isolation gap, not a payment blocker. |
| Payment mode | Live Paystack and Hubtel names are production-only. That protects preview from those secrets. It also means preview has no sandbox. |
| Hardcoded production URL | `app.finza.africa` appears in 18 non-API files. Worth a callback review before HTTP tests. |
| Tracked staging example | `.env.staging.example` contains JWT-shaped anon and service-role values for `adonhhtooawkeemdqqeo`, not blank placeholders. This audit does not repeat them. If that file is in git history, treat the staging service role as exposed and rotate it before payment tests. |

Do not copy production Paystack, Hubtel, service-role, or Resend values into staging.

## 5. Payment sandbox

| Requirement | Classification |
|---|---|
| `PAYSTACK_SECRET_KEY` on preview, test key only | MISSING |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` on preview, test key only | MISSING |
| `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED=true` on that same preview scope | MISSING. The flag is production-only today. Code enables tenant invoice Paystack only when it is the string `true`. |
| `TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY` for staging | MISSING on preview |
| Hubtel live keys on preview | Absent, which is correct. Leave Hubtel disabled. |
| MTN / MoMo env names | No key name contains MTN or MOMO. Tenant MoMo credentials are stored per business, not as a platform env. UNVERIFIED for a sandbox business. |
| Callback URL owned by the staging origin | UNVERIFIED until `NEXT_PUBLIC_APP_URL` is proven not to be `app.finza.africa` |

Paystack test keys are required. Production `sk_live` keys are forbidden on preview. This audit did not create keys.

## 6. Migration 588

Read-only, 11 October 2026.

| Database | Result |
|---|---|
| Staging `adonhhtooawkeemdqqeo` | Row `20261011131847` / `paystack_invoice_payment_reference_unique` in `supabase_migrations.schema_migrations`. Index `payments_reference_fnz_invoice_unique` exists. |
| Index definition | Unique btree on `payments(reference)` where `reference IS NOT NULL` and `deleted_at IS NULL` and `reference LIKE 'FNZ-%'` and `reference NOT LIKE 'FNZ-SUB-%'`. Matches the reviewed file. |
| Production `qjxhibvbmzogyzbhswjj` | Index absent. Live `FNZ-` rows excluding `FNZ-SUB-`: 0. |

Not reapplied. Not applied to production.

## 7. Test data and triggers

Staging counts for the Package A synthetic businesses, invoices references, and payment references used on 11 October 2026 are zero. Audit-log rows for those business ids were zero at cleanup and were not rechecked as a separate table in this pass. The business, invoice, payment, journal, and account counts for those ids are zero.

`trigger_prevent_journal_entry_modification` and `trigger_prevent_journal_entry_line_modification` are enabled (`tgenabled` O). Each is `BEFORE DELETE OR UPDATE` and calls the original prevention function. This audit did not replace those functions. The earlier concurrency test disabled them inside the cleanup transaction and re-enabled them before commit. They are enabled now. No trigger was changed in this audit, and leftover synthetic rows were not deleted because none were found.

## 8. Proposed architecture

Use the existing staging Supabase project and the existing Vercel project. Do not create another paid database. Do not deploy Package A to production.

Minimum:

1. A branch from `ee5cdb2` plus the reviewed Package A commits, deployed only as a Vercel preview or a custom environment. Not `main`, and not `app.finza.africa`.
2. A stable preview alias or a staging hostname that is not a production domain.
3. Branch-scoped env for that branch only: staging Supabase URL, staging anon key, staging service role, staging `NEXT_PUBLIC_APP_URL`, Paystack test keys, `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED=true`, a staging-only tenant-payment encryption key, and a Resend key that is empty or a test sender.
4. Confirm the Supabase URL host is `adonhhtooawkeemdqqeo.supabase.co` and the anon key `ref` claim matches, using the same style of check as the production release guard. Do not print the key.
5. Auth redirect URLs in the staging Supabase project include the staging origin and exclude `app.finza.africa`.
6. Synthetic businesses and invoices in staging only. No production tenant import.
7. Paystack test mode. Webhook and callback URLs are the staging origin. No live charge.
8. Two parallel HTTP verify calls for scenario 8, against that app, after migration 588 is already present.
9. Cleanup of synthetic payments, journals, invoices, and businesses. Do not disable journal triggers in the cleanup path; delete in an order the immutability triggers allow, or use a reviewed staging-only procedure written down before it runs.
10. Vercel SSO currently covers preview URLs. Testers need an owner-approved bypass or a staging domain. Do not turn off protection on production.

Optional, not required for the first twelve scenarios: CI `workflow_dispatch`, Hubtel test mode, MTN sandbox, preview-safe AI keys, and a rewrite of `docs/staging/setup.md`.

## 9. Setup sequence

1. Owner confirms the preview branch `staging` Supabase URL is the staging project, or discards those values and sets new ones. Rotate the staging service role if `.env.staging.example` has been shared.
2. Owner supplies Paystack test keys and a staging app URL. Do not reuse production keys.
3. Add those names only on the Package A preview branch or a dedicated staging environment.
4. Override preview Resend so it is not the production credential.
5. Deploy a preview of the accepted commit. Do not alias it to `app.finza.africa`.
6. Prove `NEXT_PUBLIC_SUPABASE_URL`, the anon key ref, and `NEXT_PUBLIC_APP_URL` before any payment call.
7. Create one synthetic service tenant and one invoice. Run the twelve scenarios. Delete the fixture.
8. Record evidence in the Package A acceptance report. Do not mark the report READY from this plan alone.

## 10. Owner decisions

| Decision | Why |
|---|---|
| Rotate staging service role or confirm the example file is harmless | JWT-shaped service-role material is in `.env.staging.example` |
| Decrypt-and-compare is an owner action | This audit refused to decrypt preview Supabase URLs |
| Paystack test keys for preview | Production keys must stay production-only |
| Staging hostname or preview bypass | SSO blocks unauthenticated browser tests |
| Whether preview may keep the shared Resend and OpenAI rows | They can act on production services |
| Retail type file, separately | Not a staging decision, but a green build needs it |

## 11. Acceptance criteria

Staging is READY only when all of these are true:

- The running app's Supabase host is `adonhhtooawkeemdqqeo.supabase.co`.
- The service role used by that app is not the production key.
- `NEXT_PUBLIC_APP_URL` is not `app.finza.africa`.
- Paystack is test mode.
- A synthetic invoice can be initialized, rejected, and verified without a live charge.
- Scenario 8 is two overlapping HTTP requests, and the staging database shows one payment and one payment journal.
- The fixture is gone afterward, and both journal immutability triggers are still enabled.
- Production deployment id is still `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` unless a later, separate approval changes it.

## 12. Remaining risks

- Preview of `staging` is the wrong SHA for Package A.
- Branch-scoped secrets for other feature branches can point at unknown databases. UNVERIFIED.
- Shared Resend and AI credentials cross the preview/production boundary.
- Crons are safe only while staging is not promoted to the production deployment.
- Eighteen files mention `app.finza.africa` and could build a production link even when `NEXT_PUBLIC_APP_URL` is correct.
- `docs/staging/setup.md` is stale and could send someone to reapply an old migration range.
- The tracked staging example may have exposed the staging service role.
