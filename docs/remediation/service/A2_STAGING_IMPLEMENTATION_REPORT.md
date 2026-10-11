# A2 — Staging implementation report

Date: 2026-10-11

Final status: **BLOCKED BY CREDENTIAL ROTATION**

Package A remains unimplemented on this branch and is not deployed. No acceptance scenario was executed against a staging application. None of the 12 HTTP scenarios is passed.

## A. Implementation

### Branch and worktree

| Item | Value |
| --- | --- |
| Worktree | `C:\projects\finza-web\finza-staging-security` |
| Branch | `chore/staging-security-readiness` |
| Starting SHA | `ee5cdb2256b59baccf85a598fbc53e083153e53b` |
| HEAD | `ee5cdb2256b59baccf85a598fbc53e083153e53b` (no commit) |
| Baseline | Production source. Not `origin/staging` (`45d8be86`). |

Starting state: clean worktree at that SHA, `npm ci` completed (Next 16.1.7). `vercel.json` disables Git deploys of `main`, region `arn1`, three production crons. No commit, push, merge, or deploy was made.

Package A (`finza-payment-auth`) and A1 (`finza-next16-build-compat`) were not edited. Both remain dirty from their own earlier work, both still at `ee5cdb2`.

### Files changed

Tracked edits:

- `.env.staging.example` — real credential material replaced with placeholders
- `docs/staging/setup.md` — stop the instruction to create a new project and reapply migrations through 496
- `lib/email/sendTransactionalEmail.ts` — staging-only send gate
- `lib/sendEmailForensicAlert.ts` — staging-only send gate
- `package.json` — `staging:check-examples` and `staging:preflight` only

New files:

- `instrumentation.ts`
- `lib/staging/stagingIsolation.ts`
- `lib/staging/stagingEmailPolicy.ts`
- `lib/staging/__tests__/stagingIsolation.test.ts`
- `lib/staging/__tests__/stagingEmailPolicy.test.ts`
- `scripts/staging/preflight-staging-env.ts`
- `scripts/staging/check-env-examples.ts`
- `.github/workflows/staging-isolation.yml`
- `docs/remediation/service/STAGING_DEPLOYMENT_RUNBOOK.md`
- `docs/remediation/service/A2_STAGING_IMPLEMENTATION_REPORT.md`

`production-release.yml` was not modified. Retail code was not modified. Package A payment logic was not modified.

### Safeguards

`FINZA_DEPLOYMENT_ENV=staging` is the staging identity. `NODE_ENV` is ignored, because Preview runs with `NODE_ENV=production`.

`instrumentation.ts` calls the isolation check only for the Node.js runtime when that identity is `staging`. Every other deployment, including production, returns without checking.

When the identity is staging, boot fails on any of:

- Supabase host other than `adonhhtooawkeemdqqeo.supabase.co`, including production ref `qjxhibvbmzogyzbhswjj`
- Anon or service-role value that is not a JWT for the staging project and the expected role
- `VERCEL_ENV=production`
- App or site URL on `app.finza.africa`, `finza.africa`, `www.finza.africa`, or the production Vercel aliases
- `sk_live_` or `pk_live_`
- Tenant invoice payments enabled without `sk_test_` / `pk_test_` keys
- Email mode missing, or `disabled` while `RESEND_API_KEY` is set, or an allowlist of `*`, a bare domain, or an empty list

`npm run staging:preflight` is the same check plus a requirement that `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED=true`. It is for the verified staging process environment. It was not run against production env files.

Send paths call `decideStagingEmailDelivery` first. Outside staging the function allows the send and production behavior is unchanged. Inside staging, `disabled` blocks every recipient, `allowlist` allows only exact addresses, and any other mode fails closed. Log lines contain the error code only.

`npm run staging:check-examples` fails if a tracked `.env*.example` contains a JWT-shaped value, a live Paystack prefix, or a Postgres URL whose password is not a placeholder.

How to configure `FINZA_DEPLOYMENT_ENV`: set it to `staging` only on the Vercel Preview branch scope described in the runbook. Do not set it on Production. The variable is documented in `.env.staging.example`.

### Tests

`npx jest lib/staging --no-coverage` — exit 0.

- `stagingIsolation.test.ts`
- `stagingEmailPolicy.test.ts`
- 2 suites, 16 tests, 0 failed

Covered: production Supabase URL, production app host, live Paystack prefixes, Package A flag, Vercel production target, Resend key while email is disabled, allowlist versus wildcard, error codes that do not echo secret material, non-JWT service-role rejection, and the tracked example file containing no JWT-shaped value.

`npm run staging:check-examples` — exit 0 (2 example files).

`npm run staging:preflight` was not executed. It needs the rotated staging secrets and must not be pointed at production.

The new GitHub workflow `.github/workflows/staging-isolation.yml` runs the example scan and `lib/staging` tests. It does not call `production-release.yml`.

## B. Security

### Credential exposure

**Security blocker.** `.env.staging.example` is tracked. Before this edit it contained JWT-shaped anon and service-role values for staging project `adonhhtooawkeemdqqeo`, not the production project.

Those values were still valid: a request to the staging REST root with the service-role value returned HTTP 200. Expiry in the payload is 2036-06-22. The check used a temporary process and recorded only the status code.

Git history still contains the service-role value in `265d634`, `5b29564`, `728f69a`, `ed56295`, and `0785c25`. `fa47f61` does not. History was not rewritten.

The working tree example now has `REPLACE_WITH_STAGING_ANON_KEY` and `REPLACE_WITH_STAGING_SERVICE_ROLE_KEY`. That does not invalidate the historical key.

No tracked example contained production ref `qjxhibvbmzogyzbhswjj` as a credential. The production ref remains only as a blocklist value, which is already public in the release guards.

The leaked service-role key was not used for payment tests.

### Rotation

Required before any staging deploy. Procedure, rollback, and verification are approval 1 below and in `STAGING_DEPLOYMENT_RUNBOOK.md`.

Affected consumers: anyone who cloned the repository, local scripts that copied the example, and the Vercel Preview `staging` branch service-role row if it was copied from that file. The Preview value was not decrypted in this assignment, so treat it as untrusted and replace it during rotation.

### Preview and production separation

Same-day name-level inspection of project `finza-app` (values not decrypted, and not fetched again):

- Production has the live Paystack keys and `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED`.
- Git branch `staging` has its own Supabase URL, anon key, service-role key, and cron secret rows. The host inside those rows was not read.
- There is no unscoped Preview Supabase URL.
- `fix/prod-payment-authorization` has no branch-scoped Supabase or Paystack rows.
- `RESEND_API_KEY` (and related Resend names) are one row targeted at both Preview and Production.
- Some AI provider keys are also shared across environments.
- Preview deployments use Vercel SSO `all_except_custom_domains`.

Repository guards now refuse a staging boot that points at production. They cannot change the shared Vercel rows. That remains an owner action.

### Email

Preferred staging policy: `FINZA_STAGING_EMAIL_MODE=disabled` and an empty Preview `RESEND_API_KEY`. Allowlist mode is available for explicit test inboxes. Production send behavior is unchanged because the gate runs only when `FINZA_DEPLOYMENT_ENV=staging`.

Supabase Auth mail does not go through this gate. Staging test users must be new accounts on the staging project, using inboxes the team controls.

### Authentication

Not configured in this assignment. Staging Auth redirects, test users, and a public webhook hostname are approval items. Do not reuse production sessions. Public invoice token routes and payment endpoints stay as implemented in Package A; this branch does not change them.

### Remaining risks

- Historical staging service-role and anon keys stay valid until rotation.
- Preview can still inherit the production Resend key until a branch override is set.
- Preview SSO blocks Paystack webhooks until a staging hostname or a narrow protection exception is approved.
- Staging branch env values were not decrypted, so their Supabase host is unverified.
- Combining A1 and Package A, and deploying that preview, has not been approved.

## C. Infrastructure

### Existing Vercel resources

- Project `finza-app`, team `team_oWPGv9x9bpRD2nRmUM2lKpzJ`
- Production alias `https://app.finza.africa`
- Last confirmed production deployment `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` (not modified)
- Newest preview of branch `staging`: `dpl_57HkjdsRurY9cha7hmsNbHQg5hCs`, SHA `45d8be86`. That deployment is not Package A and is not this baseline. Do not use it for acceptance.
- No new project was created.

### Proposed staging URL

Do not use `app.finza.africa`.

Until DNS is approved, testers use the preview URL Vercel assigns to the combined branch. That URL is behind SSO, so it is not a Paystack webhook target.

Proposed public name, approval required: `staging.finza.africa`, attached to the preview branch only.

Webhook path: `POST /api/payments/webhooks/mobile-money` on that host. Paystack is recognized from `x-paystack-signature`.

### Supabase

Staging project `adonhhtooawkeemdqqeo` (Staging Finza). Production project `qjxhibvbmzogyzbhswjj` was not written.

### Paystack sandbox

Not installed. Required on the preview branch only: `sk_test_…`, `pk_test_…`, test webhook URL on the staging host, and `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED=true` on that scope only. No charge was made.

### Missing secrets and permissions

- Rotated staging anon and service-role keys
- Paystack test secret and public key
- Preview-scoped Resend override (empty, or a staging-only key plus allowlist)
- Staging `CRON_SECRET` distinct from production
- Staging `TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY` if tenant payment settings are exercised
- Dashboard access to rotate Supabase keys, edit Vercel Preview env, edit staging Auth redirects, and optionally DNS

### Deployment prerequisites

1. Rotate the leaked staging keys.
2. Set the Preview branch env from the runbook.
3. Confirm Auth redirects.
4. Decide the public webhook hostname.
5. Combine reviewed A1, Package A, and this branch in a new worktree. Do not merge `origin/staging`.
6. Deploy that preview only after a separate approval.

## D. Database

Read-only checks against staging `adonhhtooawkeemdqqeo` and production `qjxhibvbmzogyzbhswjj`. No migration applied. No rows written. Triggers were not disabled.

| Check | Result |
| --- | --- |
| Staging migration row | `20261011131847` / `paystack_invoice_payment_reference_unique` present |
| Index | `payments_reference_fnz_invoice_unique` present; definition matches migration 588 (partial unique on `payments(reference)` for live `FNZ-%` references, excluding `FNZ-SUB-%`) |
| Production | Index absent (count 0). Migration 588 has not been applied there. |
| Synthetic Package A rows | 0 businesses and 0 payments for the earlier concurrency fixtures |
| Journal immutability | `trigger_prevent_journal_entry_modification` and `trigger_prevent_journal_entry_line_modification` enabled (`tgenabled` O), executing `prevent_journal_entry_modification()` and `prevent_journal_entry_line_modification()` |

This matches the previous audit. The earlier SQL concurrency exercise is not acceptance scenario 8.

## E. Owner approvals required

Do not execute these until accepted. Repository preparation for each item is already in the runbook.

### 1. Rotate staging Supabase API keys

- Action: regenerate the service-role key and the anon key.
- Target: Supabase project `adonhhtooawkeemdqqeo` only.
- Reason: both keys were in a tracked example and in Git history, and the service-role key was still accepted by the staging API.
- Risk: staging scripts and the current preview break until the new keys are installed. Production is out of scope and must not be edited.
- Rollback: a revoked key cannot be restored. If staging breaks, install the new key again and leave the old key revoked.
- Verification: old service-role key receives HTTP 401 on `GET /rest/v1/`; new key receives 200; `staging:preflight` passes; no key is printed.

### 2. Set Preview branch environment variables

- Action: create branch-scoped Preview variables for the future combined branch. Do not edit Production. Do not decrypt or copy production secrets.
- Target: Vercel project `finza-app`.
- Reason: Package A has no preview Supabase or Paystack configuration, and the old `staging` branch deployment is the wrong SHA.
- Risk: a wrong scope could expose staging to production data or enable invoice payments in production.
- Rollback: delete the branch-scoped rows.
- Verification: names exist only on that Preview branch; preflight error list is empty; Supabase host is `adonhhtooawkeemdqqeo.supabase.co`; no live Paystack prefix; app URL is not `app.finza.africa`.

Values to set are listed in `STAGING_DEPLOYMENT_RUNBOOK.md` section 2, including `FINZA_DEPLOYMENT_ENV=staging` and the invoice-payment flag `true` only there.

### 3. Isolate Preview email from the shared Resend credential

- Action: Preview branch override for `RESEND_API_KEY` so this branch does not use the Preview+Production row. Prefer empty, with `FINZA_STAGING_EMAIL_MODE=disabled`.
- Target: Vercel Preview scope for the combined branch. Do not change the Production Resend value.
- Reason: one Resend credential is shared by Preview and Production, so a staging test can email real customers.
- Risk: clearing the wrong scope stops production mail.
- Rollback: restore the previous Preview override. Do not delete the override if that falls back to the production key, unless production mail was the value you are restoring on purpose and only on Production.
- Verification: a staging send attempt does not leave the process (`staging_email_disabled`), and production mail settings are unchanged.

### 4. Staging Auth redirects and test users

- Action: set the staging project site URL and redirect allow list to the staging origin. Create new test users. Do not import production users.
- Target: Supabase Auth on `adonhhtooawkeemdqqeo`.
- Reason: login and callbacks must not land on `app.finza.africa`, and production sessions must not be reused.
- Risk: a bad redirect locks testers out, or a production URL added on the staging project sends a staging session to production.
- Rollback: remove the staging redirect entries.
- Verification: password reset and login return to the staging origin; `app.finza.africa` is absent from the staging allow list.

### 5. Public webhook hostname

- Action: either assign `staging.finza.africa` to the preview branch, or add a protection exception only for `POST /api/payments/webhooks/mobile-money`. Do not turn off SSO for every preview. Do not change the `app.finza.africa` DNS record.
- Target: Vercel project `finza-app`, and DNS only if the hostname is chosen.
- Reason: SSO `all_except_custom_domains` blocks Paystack from calling preview URLs. Scenario 9 cannot run without a public staging endpoint.
- Risk: a custom domain attached to production would publish the staging or the production app on the wrong host.
- Rollback: remove the domain or the path exception.
- Verification: an unauthenticated POST without a valid signature receives the application's signature failure, not a Vercel login page; `app.finza.africa` still serves production deployment `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH`.

### 6. Paystack test webhook

- Action: register the staging webhook URL in Paystack test mode and store test keys only in the Preview branch scope.
- Target: Paystack test dashboard and Vercel Preview.
- Reason: Package A acceptance needs test-mode initialization, verification, and callback replay.
- Risk: pointing the test webhook at production, or placing a live key in Preview.
- Rollback: delete the test webhook and the Preview keys.
- Verification: keys use the `sk_test_` and `pk_test_` prefixes; the webhook host is the staging host; no live charge exists.

### 7. Combine and deploy the preview

- Action: after A1 and Package A are reviewed, combine them with this branch and deploy a Preview. Do not deploy production. Do not merge `origin/staging`.
- Target: a new worktree and a Vercel Preview of `finza-app`.
- Reason: acceptance must run on the real staging app. This assignment does not deploy.
- Risk: promoting the preview onto `app.finza.africa`.
- Rollback: delete the preview. If production was replaced by mistake, promote `dpl_5gqka3rLGbHhK17tDXqQwUVz1LtH` again.
- Verification: preview alias list does not include `app.finza.africa`; preflight passes; then run the 12 scenarios and record results only from those HTTP runs.

## F. Final status

**BLOCKED BY CREDENTIAL ROTATION**

Local staging guards, placeholder examples, tests, and the runbook are in place. The authorized rotation on 2026-10-11 did not run. See `Staging Credential Rotation — Execution and Verification`. The exposed staging service-role credential is still accepted. Staging must not be deployed, and Package A must not be payment-tested, until that credential is rejected.

## Staging Credential Rotation — Execution and Verification

Rotation status: **BLOCKED — OWNER ACTION REQUIRED**

The exposed service-role credential is still valid. The incident is not resolved.

### When

2026-10-11, UTC+2, in the authorized staging-only rotation session.

### Target

Supabase project `adonhhtooawkeemdqqeo`, name Staging Finza, organization `uylkpjekdhckqrdgjbog`, region `eu-west-1`, status `ACTIVE_HEALTHY`. Confirmed with `get_project` before any other call.

Production project `qjxhibvbmzogyzbhswjj`, name Finza Pro, organization `xcxsszgtsagcrpqmwpep`, was read for identity only. No production API-key, database, or deployment call was a write.

### Key architecture

The exposed values are legacy long-lived JWTs (`anon` and `service_role`), not the newer `sb_publishable_` / `sb_secret_` keys.

Current Supabase documentation:

- Creating a publishable or secret key does not revoke legacy JWTs.
- Legacy `anon` and `service_role` keys are retired by deactivating them under Settings → API Keys, or with `PUT /v1/projects/{ref}/api-keys/legacy?enabled=false`.
- That disable is reversible and applies to the legacy key pair together.
- Rotating the project JWT signing secret is a separate step. It is what invalidates user session JWTs and other tokens signed by that secret. It is not required to revoke the leaked API keys if legacy-key deactivation causes the gateway to reject them.

JWT signing-secret rotation was not performed.

### Why rotation did not run

The Supabase MCP session can read project metadata and run SQL. It has no API to disable legacy keys.

The Management API token stored for the Supabase CLI (Windows Credential Manager target `Supabase CLI:supabase`) is a personal access token. `GET /v1/projects/adonhhtooawkeemdqqeo/api-keys/legacy` and `GET /v1/projects/adonhhtooawkeemdqqeo/api-keys` both returned HTTP 401 `Invalid access token`. The CLI is not installed, so that token could not be refreshed from this session.

No disable call was sent. No replacement key was created. No JWT secret was changed. No Vercel, Paystack, Resend, or Auth redirect setting was changed.

### Old-key probe

Read-only `GET /rest/v1/` on `https://adonhhtooawkeemdqqeo.supabase.co` using the credentials still present in `HEAD:.env.staging.example`. The working tree file is the sanitized copy. Values were not printed.

| Credential | JWT role | Project ref | Result |
| --- | --- | --- | --- |
| Service role | `service_role` | staging, not production | HTTP 200, accepted |
| Anon | `anon` | staging, not production | HTTP 401, `invalid_api_key` |

`/rest/v1/` is an admin endpoint. HTTP 200 means the service-role key was accepted. HTTP 403 would mean a recognized non-admin key. HTTP 401 means the gateway rejected the key. The committed anon JWT is already rejected. This session did not change it. Legacy keys are not disabled as a pair, because the service-role JWT is still accepted.

### Replacement keys

None created. Nothing to verify.

### Staging services that still depend on the exposed service-role key

- The Vercel Preview branch scope named `staging`, if its service-role row is this key. Values were not read.
- Any local untracked env file copied from the old example.
- Git history. Deactivation is what makes those copies fail.

The staging project has no Edge Functions. Disabling the legacy keys will not change production, which is a different project and a different organization. It will break staging clients that still send the legacy service-role JWT until they receive a new secret key.

### Database integrity

Read-only counts before and after the session match. No migration, schema change, or financial write was issued.

| Check | Result |
| --- | --- |
| Migration `20261011131847` | Present |
| `payments_reference_fnz_invoice_unique` | Present |
| Journal immutability triggers | Both enabled (`O`), original functions |
| `payments` | 228 |
| `journal_entries` | 1716 |
| `journal_entry_lines` | 3926 |
| `invoices` | 521 |

### Production isolation

| Check | Result |
| --- | --- |
| Production project id | Still `qjxhibvbmzogyzbhswjj` |
| Production API keys | No management call was made against that project |
| Production Vercel env and deployment | No Vercel call was made |
| Production payment configuration | Not changed |

### Remaining owner action

Refresh a Management API token that can write API keys, then ask for the rotation to be run again. Do not paste the token into chat.

Either:

1. Install the Supabase CLI and run `supabase login` on this machine, replacing the rejected credential at `Supabase CLI:supabase`. The follow-up call must be `PUT /v1/projects/adonhhtooawkeemdqqeo/api-keys/legacy?enabled=false` after a publishable key and a secret key exist. Creating those keys does not revoke the leaked JWT.
2. Or, in the dashboard for Staging Finza only: Settings → API Keys, create a publishable key and a secret key, store them in a password manager, then deactivate the legacy `anon` and `service_role` keys. Do not open Finza Pro.

After deactivation, the same service-role probe must return HTTP 401 before this incident can be marked resolved. Do not rotate the JWT signing secret unless deactivation leaves the service-role JWT accepted. That rotation would also invalidate staging Auth sessions and staging storage URLs.

Vercel Preview still needs the replacement keys before a staging deploy. That remains a separate approval. Do not put the new keys in `.env.staging.example` or any tracked file.

## Legacy API Key Revocation — Post-Disable Verification

Verification status: **VERIFICATION INCOMPLETE**

The owner disabled legacy JWT API keys in the Staging Finza dashboard. This check did not create, rotate, delete, or re-enable any credential. Probes used `GET /rest/v1/` on `https://adonhhtooawkeemdqqeo.supabase.co` only. That path requires an accepted admin key for HTTP 200. A public key that is accepted but not admin returns HTTP 403. An unrecognized or disabled key returns HTTP 401. An invalid control key returned HTTP 401 `invalid_api_key`, so the endpoint is not anonymous.

Date: 2026-10-11, UTC+2. Project confirmed first: Staging Finza, `adonhhtooawkeemdqqeo`, organization `uylkpjekdhckqrdgjbog`, `ACTIVE_HEALTHY`.

| Check | Result | Evidence |
| --- | --- | --- |
| Old service-role key rejected | PASS | HTTP 401 `legacy_disabled`. JWT role `service_role`. `ref` is the staging project, not production. |
| Old anon key rejected | PASS | HTTP 401 `legacy_disabled`. JWT role `anon`. `ref` is the staging project, not production. |
| New publishable key accepted | BLOCKED | Management API `GET /v1/projects/adonhhtooawkeemdqqeo/api-keys` returned HTTP 401. The replacement key was not retrieved or sent. |
| New secret key accepted | BLOCKED | Same management-token rejection. No secret key was retrieved or sent. |
| Staging project identity | PASS | `get_project` returned Staging Finza, ref `adonhhtooawkeemdqqeo`. |
| Production unchanged | PASS | `get_project` still returns Finza Pro, ref `qjxhibvbmzogyzbhswjj`, organization `xcxsszgtsagcrpqmwpep`, `ACTIVE_HEALTHY`. No production authentication probe and no write. |
| Migration 588 intact | PASS | `20261011131847` / `paystack_invoice_payment_reference_unique` present. Index `payments_reference_fnz_invoice_unique` present. Package A synthetic payment references: 0. |
| Journal triggers intact | PASS | `trigger_prevent_journal_entry_modification` and `trigger_prevent_journal_entry_line_modification` enabled (`O`), original functions. |

The two exposed legacy JWTs were read from `HEAD:.env.staging.example` inside the probe process and were not printed. Both are rejected with `legacy_disabled`, which is distinct from the control key's `invalid_api_key`. They no longer grant privileged access: the service-role probe is HTTP 401, not HTTP 200.

The working-tree `.env.staging.example` contains placeholders only. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is `REPLACE_WITH_STAGING_PUBLISHABLE_KEY`. `SUPABASE_SERVICE_ROLE_KEY` is `REPLACE_WITH_STAGING_SECRET_KEY`. `NEXT_PUBLIC_SUPABASE_URL` is `https://adonhhtooawkeemdqqeo.supabase.co`. The production project ref appears only as the blocklist `FINZA_PRODUCTION_SUPABASE_PROJECT_REF`. No production secret was added. Git history was not rewritten. The historical copies remain in Git and are now rejected by the staging API.

## New API key compatibility

Verdict: **READY FOR VERCEL PREVIEW CONFIGURATION**

Legacy JWT API keys stay rejected. Staging validation accepts only `sb_publishable_` in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `sb_secret_` in `SUPABASE_SERVICE_ROLE_KEY`. Those prefixes classify the credential. They do not prove the project. Boot and `npm run staging:preflight` then call `GET /rest/v1/` on `https://adonhhtooawkeemdqqeo.supabase.co` only. A recognized publishable key returns HTTP 401 with `Secret API key required`, or HTTP 403 when the gateway refuses a non-admin key. `Invalid API key` fails closed. HTTP 200 means the secret key is privileged. `FINZA_DEPLOYMENT_ENV=staging` is still required. `NODE_ENV` is not a staging signal. Production startup returns before these checks.

Installed clients, with no dependency change:

- `@supabase/supabase-js` 2.84.0
- `@supabase/auth-js` 2.84.0
- `@supabase/ssr` 0.7.0

`createClient` sends the API key as the `apikey` header. It JWT-decodes user access tokens, not the API key. `lib/supabaseClient.ts` ignores a non-JWT publishable key and still passes it to `createBrowserClient`. Its browser guard still only recognizes a legacy `service_role` JWT, not an `sb_secret_` value pasted into the public variable. The staging boot check rejects that mix before a staging server stays up. Shared client files were not edited.

`npx jest lib/staging --no-coverage` exited 0: 2 suites, 20 tests. That includes legacy-key rejection, publishable and secret formats, the publishable `Secret API key required` response, wrong-project URL, production host, Paystack live keys, email isolation, missing credentials, explicit staging identity, production identity left unset, and error codes that do not echo secret material. `npm run staging:preflight` with an empty environment exited 1 and printed only missing-variable codes. It did not call the API.

The gitignored `.env.staging` now holds staging keys, and `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED=true` for the local Package A acceptance file only. Paystack values in that file are test keys. A live probe of that file against `https://adonhhtooawkeemdqqeo.supabase.co/rest/v1/` returned publishable HTTP 401 `recognized_public` and secret HTTP 200 `accepted_admin`, and the Package A static check passed. An invalid publishable control returned HTTP 401 `Invalid API key`. The same publishable key returned HTTP 200 from `/auth/v1/settings` on that staging host. The rejected Management API token was not retried. Values were not printed. The tracked `.env.staging.example` still has the payment flag set to `false`.

Owner action: copy those local values into the future Preview branch scope, using the variable names in `STAGING_DEPLOYMENT_RUNBOOK.md` section 2. Set the preview app URL there, and set the tenant invoice payment flag to `true` only on that preview. Do not paste keys into chat. Do not re-enable legacy keys.

## Safety confirmation

| Check | State |
| --- | --- |
| Production application | Unchanged. No deploy. |
| Production Supabase | Unchanged. Read-only checks only. |
| Production Vercel env | Unchanged. Values not decrypted and not written. |
| Live payments | None. |
| Customer emails | None. |
| Retail | Unchanged. |
| Package A worktree | Unchanged by A2. Still dirty from Package A work. HEAD `ee5cdb2`. |
| A1 worktree | Unchanged by A2. Still dirty from A1 work. HEAD `ee5cdb2`. |
| Migrations | None applied. |
| Commit / push / merge | None. |

### A2 git status

Branch `chore/staging-security-readiness` at `ee5cdb2256b59baccf85a598fbc53e083153e53b`.

```
 M .env.staging.example
 M docs/staging/setup.md
 M lib/email/sendTransactionalEmail.ts
 M lib/sendEmailForensicAlert.ts
 M package.json
?? .github/workflows/staging-isolation.yml
?? docs/remediation/
?? instrumentation.ts
?? lib/staging/
?? scripts/staging/
```
