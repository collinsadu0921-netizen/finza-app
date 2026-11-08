# FINZA — F-01 Ledger Posting Security Correction Plan

**Task:** FINZA-TAX-FIX-02 (separate correction; not implemented in the tax remediation)
**Finding:** F-01 — unauthenticated/unauthorized journal posting through exposed `SECURITY DEFINER` RPCs
**Status:** Blocked pending explicit authorization. This document is a plan, not an applied fix.
**Baseline:** `80ae1717a96bd452c5d8cd07089685b8455e7220` (pre-existing on `main` at `9008fe3c4faa620bb9cdcb904b6d119579db8636`)

---

## 1. Why this is separate

F-01 predates the tax-fix branch and affects the shared ledger-posting surface. The tax
remediation must not silently rewrite `post_journal_entry` or revoke grants that many
internal callers depend on. This plan defines the smallest safe correction and the evidence
required before it is applied.

## 2. Exposed functions

| Function | Kind | Current exposure | Risk |
|---|---|---|---|
| `public.post_journal_entry(...)` | `SECURITY DEFINER` ledger writer | Default `PUBLIC` execute; `anon` can call | Arbitrary balanced journal posting, financial-statement manipulation |
| `public.post_wht_remittance_to_ledger(uuid,text)` | `SECURITY DEFINER` ledger writer | Default `PUBLIC` execute; `anon` can call | Duplicate WHT settlement journals; repoints `wht_remittances.journal_entry_id` |
| Other posting/reversal RPCs discovered by audit | `SECURITY DEFINER` | To be enumerated | Same class of risk |

The independent review reproduced both exposures against an isolated production-schema
clone (`anon-post-journal-test.js`, `anon-wht-ledger-test.js`). The production schema clone
reported `has_function_privilege('anon', ...) = true` for both functions.

## 3. Trusted internal callers

- Table triggers that post invoices, bills, payments, credit notes, expenses and retail sales.
- `post_vat_return_payment_atomic` and `reverse_vat_return_payment`.
- `create_wht_remittance_atomic` → `post_wht_remittance_to_ledger`.
- Service-role and migration/background execution.
- Authorized application RPCs that must remain callable by authenticated users.

## 4. Required authentication and authorization

At the top of every ledger-writing RPC:

1. Allow `auth.role() = 'service_role'` for trusted internal execution.
2. Reject `auth.uid() IS NULL` with `42501`.
3. Require access to the target business (`finza_user_can_access_business`).
4. Require financial-write entitlement (`finza_business_can_write_service_records`).
5. Require the minimum tier for the operation where applicable.
6. Require owner/admin/accountant authority and reject `accountant_readonly`.
7. Require `accounting.view` (or the operation-specific permission).
8. Validate that referenced accounts, journals and documents belong to the same business.

The shared guard added in migration 621 (`finza_assert_accounting_write_authorized`) is a
reusable implementation, but it is deliberately not yet wired into `post_journal_entry`.

## 5. Minimum safe migration

### Step 1 — Enumerate and classify callers

- Search all migrations, triggers, RPCs, API routes and client code for direct
  `post_journal_entry` and `post_wht_remittance_to_ledger` calls.
- Classify each caller as trusted trigger/internal, service-role, or authenticated client.
- Replace any direct authenticated-client posting with a narrowly scoped authorized RPC.

### Step 2 — Add the guard without changing grants

- Add the authorization guard to `post_journal_entry` (new overload/body).
- Keep existing grants for one staging canary so callers can be observed.
- Add negative tests: anon, non-member, read-only accountant, cross-tenant account IDs.
- Add positive tests: owner, admin, accountant with `accounting.view`, service role,
  trigger path.

### Step 3 — Make WHT remittance internal-only

- Revoke `EXECUTE` from `PUBLIC`, `anon` and `authenticated` on
  `post_wht_remittance_to_ledger`.
- Grant only to `postgres`/`service_role`.
- Keep `create_wht_remittance_atomic` as the authorized caller.
- Add an idempotency test proving a second call cannot repoint the remittance journal.

### Step 4 — Revoke broad grants

- Revoke `EXECUTE` from `PUBLIC` and `anon` on all posting/reversal RPCs.
- Grant only to `authenticated` where the authorized RPC is intentionally client-callable,
  and to `service_role`.
- Audit every `SECURITY DEFINER` function that writes `journal_entries`,
  `journal_entry_lines`, `vat_returns`, `wht_remittances` or tax-control balances.

### Step 5 — Staging verification and rollout

- Apply to an isolated production-schema/data clone and run the negative/positive suite.
- Deploy to staging and monitor `42501`/permission errors by RPC name.
- Apply to production only in a separately authorized change window.
- Keep a rollback migration that restores the previous grants, but do not use it to excuse
  leaving the exposure open.

## 6. Risks of revoking existing permissions

| Risk | Mitigation |
|---|---|
| A client or API route calls `post_journal_entry` directly and breaks | Enumerate callers first; replace with authorized wrappers; canary on staging |
| Trigger paths stop posting | Triggers execute as the table owner; verify with SQL tests before revoking |
| Service-role jobs lose access | Explicitly grant `service_role`; test background paths |
| Overloaded function signatures remain exposed | Revoke on every signature, not just the primary one |
| Migration replay on a fresh database | Include grants/revokes in the migration and test from the production schema clone |
| Emergency rollback weakens security | Fix callers; use rollback only for a bounded incident window |

## 7. Negative security tests

```sql
-- Anonymous direct posting is rejected.
SET ROLE anon;
SELECT public.post_journal_entry(...); -- expect 42501

-- Authenticated non-member is rejected.
SELECT set_config('request.jwt.claim.sub', '<non-member-uuid>', true);
SELECT public.post_journal_entry(...); -- expect ACCOUNTING_WRITE_FORBIDDEN

-- Read-only accountant is rejected.
SELECT public.post_journal_entry(...); -- expect ACCOUNTING_WRITE_READ_ONLY

-- Cross-tenant account IDs are rejected.
SELECT public.post_journal_entry(...); -- expect account/business mismatch

-- Service role and internal trigger paths still post.
SET ROLE service_role;
SELECT public.post_journal_entry(...); -- expect success

-- WHT remittance cannot be re-posted or repointed.
SELECT public.post_wht_remittance_to_ledger(...); -- expect permission denied or idempotent reuse
```

## 8. Authorization required

Before implementation, obtain explicit approval for:

1. Modifying the shared `post_journal_entry` body.
2. Revoking `PUBLIC`/`anon` execute grants.
3. Making `post_wht_remittance_to_ledger` internal-only.
4. A staging canary and production change window.

Until then, F-01 remains a release blocker and is not claimed as fixed by this tax task.
