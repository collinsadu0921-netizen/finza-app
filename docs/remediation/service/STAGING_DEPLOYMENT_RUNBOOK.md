# Staging deployment runbook — Finza Service Package A

This runbook prepares an isolated staging application for Service Package A. It does not deploy production, apply production migrations, or run charges.

Commands are marked **Safe now** or **Owner approval**. Do not run an approval step until the owner accepts the matching item in `A2_STAGING_IMPLEMENTATION_REPORT.md`.

Worktrees that must stay untouched:

- Package A: `C:\projects\finza-web\finza-payment-auth` (`fix/prod-payment-authorization`)
- A1: `C:\projects\finza-web\finza-next16-build-compat` (`fix/next16-build-compatibility`)
- Retail paths

A2 worktree: `C:\projects\finza-web\finza-staging-security`, branch `chore/staging-security-readiness`, base `ee5cdb2256b59baccf85a598fbc53e083153e53b`.

## Arrangement

Use the existing Vercel project `finza-app` (`prj_BxbfIgXTl1PAX6W3635Nsc8KXuW1`). Put staging values on a **Preview branch scope** for the branch that will be deployed. Do not create a new Vercel project. Do not attach staging to `app.finza.africa`.

`NODE_ENV` is not a staging signal. Preview builds run with `NODE_ENV=production`. Staging identity is `FINZA_DEPLOYMENT_ENV=staging`.

Proposed public name, only after DNS approval: `staging.finza.africa`, assigned to that preview branch and not to production. Until then, testers use the Vercel preview URL. Paystack cannot call a preview URL while Vercel SSO is `all_except_custom_domains`. Scenario 9 waits on that approval.

Webhook path the provider must call:

`POST /api/payments/webhooks/mobile-money`

Paystack is detected from `x-paystack-signature`. The full URL is `https://<staging-host>/api/payments/webhooks/mobile-money`.

---

## 1. Credential rotation

**Done for legacy API keys.** The owner disabled legacy JWT API keys on staging project `adonhhtooawkeemdqqeo`. Post-disable probes returned HTTP 401 `legacy_disabled` for both the exposed service-role JWT and the exposed anon JWT. Do not re-enable them.

Replacement keys are the new `sb_publishable_` and `sb_secret_` values. Put them in the existing variables `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. A key prefix does not prove the project. `npm run staging:preflight` calls `GET /rest/v1/` on `https://adonhhtooawkeemdqqeo.supabase.co` only. A recognized publishable key is refused there with HTTP 401 and the message `Secret API key required`, or with HTTP 403 when the gateway refuses a non-admin key. `Invalid API key` is a rejection. The secret key must be privileged (HTTP 200). A key from another project fails that probe.

Do not rotate the JWT signing secret unless a later check shows the disabled legacy JWTs are accepted again. Do not change project `qjxhibvbmzogyzbhswjj`.

Store replacement values in the team secret store. Do not commit them. Do not paste them into chat, logs, or Git.

## 2. Vercel Preview environment

**Owner approval.** Project `finza-app`. Environment: Preview. Scope: the future combined branch only (A1 signatures + Package A + these staging guards). Do not edit Production. Do not reuse the old `staging` branch deployment (`45d8be86`); that SHA is not Package A and is not `ee5cdb2`.

Set:

| Name | Value rule |
| --- | --- |
| `FINZA_DEPLOYMENT_ENV` | `staging` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://adonhhtooawkeemdqqeo.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging `sb_publishable_` key. Not a legacy JWT. |
| `SUPABASE_SERVICE_ROLE_KEY` | staging `sb_secret_` key. Not a legacy JWT. |
| `NEXT_PUBLIC_APP_URL` | staging origin, never `https://app.finza.africa` |
| `NEXT_PUBLIC_SITE_URL` | same staging origin |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` only |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | `pk_test_…` only |
| `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED` | `true` on this branch scope only |
| `FINZA_STAGING_EMAIL_MODE` | `disabled`, or `allowlist` with explicit test inboxes |
| `FINZA_STAGING_EMAIL_ALLOWLIST` | empty when mode is `disabled` |
| `RESEND_API_KEY` | empty when mode is `disabled`; a staging-only key when mode is `allowlist` |
| `CRON_SECRET` | a new staging value, not the production secret |

Also add a Preview-scoped override that **replaces** the shared Preview+Production `RESEND_API_KEY` for this branch. Today one Resend row targets both Preview and Production. Do not change the Production value.

Leave production-only keys untouched: live Paystack, Hubtel, `TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY` if it is production-only. Staging needs its own payment-config encryption key if tenant payment settings are exercised. Do not copy the production key.

Rollback: delete the branch-scoped Preview rows. Production rows stay.

Verification: open the deployment’s runtime env names (not values) and run `npm run staging:preflight` with that env loaded locally or via a one-off build log that prints only the preflight error codes.

## 3. Staging Supabase

**Safe now (already true):** project `adonhhtooawkeemdqqeo` exists. Migration `20261011131847` (`paystack_invoice_payment_reference_unique`) is applied there only. Do not reapply it. Do not apply it to production.

**Owner approval:** Authentication → URL configuration:

- Site URL = the staging origin
- Redirect allow list includes the staging origin and its auth callback
- `https://app.finza.africa` is not a staging redirect
- Create new test users in this project. Do not import production users or sessions.

Supabase Auth mail is not sent through Resend. Test accounts must use inboxes the team controls, never a customer address.

Rollback: remove the staging redirect URLs. Do not delete production redirect URLs; they live on the other project.

## 4. Paystack test mode

**Owner approval.** Paystack test dashboard, not live.

- Install the test secret and test public key only in the Preview branch scope from step 2.
- Callback / webhook URL: `https://<staging-host>/api/payments/webhooks/mobile-money`
- Do not register `https://app.finza.africa/...` as the test webhook.
- Leave `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED` unset or not `true` on Production.
- Do not run a charge during A2. The first charge is an acceptance test after deploy approval.

Rollback: delete the test webhook in Paystack and remove the Preview keys.

## 5. Email isolation

**Safe now (in this branch):** when `FINZA_DEPLOYMENT_ENV=staging`, Resend sends from `sendTransactionalEmail` and `sendEmailForensicAlert` are blocked unless `FINZA_STAGING_EMAIL_MODE=allowlist` and the recipient is listed. `disabled` blocks every recipient. Any other mode fails closed. Other deployment identities are unchanged.

**Owner approval:** the Preview Resend override in step 2. Preferred setting is `FINZA_STAGING_EMAIL_MODE=disabled` and an empty `RESEND_API_KEY`, so a missed code path still has no key.

Do not send a test message to a customer.

## 6. Staging URL

**Safe now:** do not use `https://app.finza.africa`. Human testing can use the preview hostname Vercel assigns after a later deploy.

**Owner approval if webhooks are required:** DNS for `staging.finza.africa` (or another non-production name) pointing at the preview branch, with Vercel SSO not covering that hostname. Do not change the `app.finza.africa` record.

## 7. Environment preflight

**Safe now**, from `C:\projects\finza-web\finza-staging-security`:

```powershell
npm run staging:check-examples
npx jest lib/staging --no-coverage
```

`npm run staging:preflight` reads the current process environment and exits 1 until staging secrets are present. Run it only against a staging env file that is gitignored. It prints error codes, not values. Do not point it at production `.env.local`.

The boot guard is `instrumentation.ts`. It runs only when `FINZA_DEPLOYMENT_ENV=staging` and `NEXT_RUNTIME=nodejs`. Production startups do not call it.

## 8. Combine reviewed branches

**Owner approval. Not part of A2.**

After A1 and Package A are reviewed, combine in a new worktree from `ee5cdb2`:

1. A1 route-param signatures and the lint script change
2. Package A payment files and migration file `588` (file only; staging database already has the index)
3. This branch’s staging guards, example placeholders, and docs

Do not merge `origin/staging` (`45d8be86`). Do not merge Retail or OCR work.

## 9. Staging-only deployment

**Owner approval.** Deploy the combined branch as a Vercel Preview. Confirm:

- The deployment is not aliased to `app.finza.africa`
- Production deployment `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` is unchanged
- Preflight codes are empty
- The Supabase URL host is `adonhhtooawkeemdqqeo.supabase.co`

## 10. Smoke test

**Owner approval, after deploy.** No production data.

- Staging login with a user created in the staging project
- Service dashboard loads
- One synthetic invoice in the staging business
- Open the public invoice token route
- Confirm email was not delivered to anyone outside the allowlist (or that no Resend call occurred when mode is `disabled`)

## 11. Twelve acceptance scenarios

**Owner approval, after deploy.** Execute against the staging URL. Do not mark any row passed from SQL or from unit tests.

1. Authorized payment initialization
2. Unauthorized payment rejection
3. Cross-tenant payment rejection
4. Pending payment behavior
5. Failed payment behavior
6. Successful payment settlement
7. Sequential verification replay
8. Concurrent verification requests
9. Provider callback replay
10. Correct invoice-payment relationship
11. No duplicate journal or ledger effects
12. Service subscription (`FNZ-SUB-`) regression

Use Paystack test mode and synthetic staging invoices. Scenario 9 needs the public webhook URL from step 6.

## 12. Rollback or shutdown

**Owner approval to execute.**

- Vercel: delete the preview deployment or disable the branch’s Preview env. Do not redeploy production.
- If a preview was promoted by mistake, promote production deployment `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` again and stop.
- Paystack: remove the staging webhook.
- Supabase: leave migration 588 in place on staging. Do not drop `payments_reference_fnz_invoice_unique` unless the owner is rolling back the index itself: `DROP INDEX public.payments_reference_fnz_invoice_unique;` on staging only.
- Do not disable `trigger_prevent_journal_entry_modification` or `trigger_prevent_journal_entry_line_modification`.
- To stop email, set `FINZA_STAGING_EMAIL_MODE=disabled` and clear the Preview `RESEND_API_KEY`.
