# FINZA — CRITICAL LEDGER SECURITY CORRECTION REPORT

**Task ID:** FINZA-SEC-01
**Finding:** F-01 — unauthorized journal posting through exposed PostgreSQL RPCs
**Branch:** `fix/finza-tax-fix-01`
**Starting SHA:** `dede88c7bf4a08c1a4ef86f8e83e8a00b8541cdd`
**Ending implementation SHA:** `c68b01011616163876182f2ac5a82d2ca6d559ef`
**Report status:** Implementation and isolated verification complete. No merge, push, deployment, production migration or production data change was performed.

---

## 1. Summary

F-01 was corrected with one additive migration (`627_ledger_posting_security.sql`) and focused
tests. Anonymous execution is removed from the journal-posting surface; direct authenticated
posting now requires full accounting-write authority; actor identity cannot be spoofed through
the generic writer; the WHT ledger writer is internal-only and idempotent; and every direct
journal writer was removed from the `anon` execution surface.

The correction was applied to two isolated clones:

1. a production-schema clone, and
2. a production-data clone containing 304 invoices, 33 bills, 22 credit notes, 185 expenses,
   12 VAT returns, 1,004 journal entries and 3,606 journal lines.

Existing financial rows and journal counts were unchanged. All nine FINZA-TAX-FIX-02 SQL
tests, the new security ACL test, the new role-based integration test and a two-session WHT
concurrency test pass on both clones. TypeScript and the 40 focused tax/security Jest suites
also pass.

---

## 2. Confirmed vulnerability

### 2.1 Affected signatures

| Function | Overloads / signature | Security | Existing exposure |
|---|---|---|---|
| `public.post_journal_entry` | `(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid)` | `SECURITY DEFINER` | `PUBLIC`/`anon` execute; guard skipped when `auth.uid()` was `NULL` |
| `public.post_journal_entry` | `(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid)` | invoker wrapper | `PUBLIC`/`anon` execute |
| `public.post_journal_entry` | `(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid)` | invoker wrapper | `PUBLIC`/`anon` execute |
| `public.post_wht_remittance_to_ledger` | `(uuid,text)` | `SECURITY DEFINER` | `PUBLIC`/`anon` execute; no row lock or idempotency; repointed `wht_remittances.journal_entry_id` |
| `public.post_journal_entry_with_request_metadata` | `(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid,text,text)` | `SECURITY DEFINER` | `PUBLIC`/`anon` execute; accepted a caller-supplied actor UUID and rewrote `request.jwt.claim.sub` |
| Other direct journal writers | `post_adjustment_to_ledger`, `post_cit_payment_to_ledger`, `post_reconciliation_journal_entry`, `post_asset_*`, `post_payroll_*`, `post_opening_balance_*`, `post_service_intent_*`, `post_manual_journal_draft_to_ledger`, `repost_expense_to_ledger`, etc. | mixed `SECURITY DEFINER` | `PUBLIC`/`anon` execute |

### 2.2 Reproduction observed

In the isolated clone, the full 17-argument `post_journal_entry` could be executed by the
`anon` role and posted a balanced journal. The function-level guard contained:

```sql
IF auth.uid() IS NOT NULL
   AND COALESCE(auth.role(), '') <> 'service_role'
   AND pg_trigger_depth() = 0 THEN
  PERFORM public.finza_assert_direct_journal_write_authorized(...);
END IF;
```

A `NULL` `auth.uid()` therefore skipped authorization entirely.

The actual PostgREST-like role model was also tested (`session_user = authenticator`,
`current role = anon`, anon JWT claims). In that model the existing table trigger
`finza_enforce_ledger_insert_authorized` rejected the insert with
`LEDGER_WRITE_UNAUTHORIZED`, but:

- the function ACLs still granted `EXECUTE` to `PUBLIC`/`anon`;
- the `post_journal_entry` guard still had the `auth.uid() IS NULL` bypass;
- `post_wht_remittance_to_ledger` and `post_journal_entry_with_request_metadata` remained
  directly callable by client roles;
- `post_journal_entry_with_request_metadata` allowed an anon/authenticated caller to supply a
  different actor UUID and have it written into `request.jwt.claim.sub`;
- direct writers such as `post_adjustment_to_ledger` did not pass through
  `post_journal_entry` at all.

The correction removes the ACL exposure and the guard bypass, and hardens the alternative
writer boundary.

---

## 3. Legitimate-caller inventory

| Caller | Execution identity | Function invoked | Required permission | Expected behavior after fix |
|---|---|---|---|---|
| Invoice create/send | authenticated API → DB trigger | `post_invoice_to_ledger_pkgb_body` → `post_journal_entry` | document access + trigger path | Preserved (trigger depth bypass) |
| Invoice payment | authenticated API → DB trigger | `post_invoice_payment_to_ledger_pkgb_body` → `post_journal_entry` | document access + trigger path | Preserved |
| Bill create/update | authenticated API → DB trigger | `post_bill_to_ledger_pkgb_body` → `post_journal_entry` | document access + trigger path | Preserved |
| Supplier payment | authenticated API → DB trigger | `post_supplier_payment_to_ledger` → `post_journal_entry` | document access + trigger path | Preserved |
| Expense create/update | authenticated API → DB trigger | `post_expense_to_ledger_pkgb_body` / `repost_expense_to_ledger` → `post_journal_entry` | document access + trigger path | Preserved |
| Credit note | authenticated API → DB trigger | `post_credit_note_to_ledger_pkgb_body` → `post_journal_entry` | document access + trigger path | Preserved |
| Retail sale/refund/void | authenticated API → DB trigger | `post_sale_to_ledger_pkgb_body*` / refund/void → `post_journal_entry` | document access + trigger path | Preserved |
| WHT remittance | authenticated API → `create_wht_remittance_atomic` | `post_wht_remittance_to_ledger` → `post_journal_entry` | business access, accounting.view, write entitlement | Preserved; internal WHT writer now service-role/owner only |
| VAT payment | authenticated API → `post_vat_return_payment_atomic` | `post_journal_entry` | business access, subscription, tier, accounting authority | Preserved |
| VAT reversal | authenticated API → `reverse_vat_return_payment` | `post_journal_entry` | business access, subscription, tier, accounting authority | Preserved |
| CIT provision/payment | authenticated API → `post_cit_provision_to_ledger` / `post_cit_payment_to_ledger` | `post_journal_entry` | business access + accounting authority | Preserved; authenticated grant retained |
| Payroll posting/reversal | authenticated API → payroll RPCs | `post_payroll_to_ledger`, `_post_payroll_payment_journal_internal`, `reverse_payroll_*` | payroll/accounting authority | Preserved; internal helpers service-role only |
| Asset purchase/disposal/depreciation | authenticated API → asset RPCs | `post_asset_*`, `post_depreciation_to_ledger` | accounting authority | Preserved; authenticated grant retained |
| Opening balances / manual journals | authenticated API → RPC | `post_opening_balance_import_to_ledger`, `post_manual_journal_draft_to_ledger`, `post_service_manual_journal_draft` | accounting authority + draft checks | Preserved; authenticated grant retained |
| Journal reversal | authenticated API → service-role admin client | `post_journal_entry_with_request_metadata` | service role only | Preserved; wrapper now internal-only |
| Service manual reversal | authenticated API → `reverse_service_manual_journal_with_request_metadata` | `reverse_service_manual_journal` → `post_journal_entry` | accounting authority | Preserved; base function internal-only |
| Payroll Paystack settlement | server-side admin client | `settle_payroll_paystack_transfer_atomic` / `reverse_payroll_paystack_transfer_atomic` | service role only | Preserved; internal-only |
| Cleanup/repair jobs | server-side/admin | `repair_orphan_invoice_payment_journals`, `finza_*` cleanup | service role only | Preserved; internal-only |
| DB triggers/scheduled processes | table owner / trigger context | various posting functions | trigger depth | Preserved (trigger depth bypass) |

---

## 4. Root cause

1. **Function ACLs defaulted to `PUBLIC`.** Every overload and the WHT/metadata writers were
   executable by `anon`.
2. **The function guard skipped `NULL` `auth.uid()`.** Anon sessions therefore bypassed the
   direct journal-write authorization.
3. **The WHT writer trusted its input and repointed journal links.** It had no row lock and no
   early return for an already-linked remittance.
4. **The metadata wrapper trusted a caller-supplied actor UUID.** It rewrote
   `request.jwt.claim.sub`, enabling identity spoofing.
5. **Alternative direct writers bypassed the generic writer.** Functions such as
   `post_adjustment_to_ledger` inserted into `journal_entries` directly.
6. **The table guard checked business access only.** It did not require accounting-write
   authority for direct authenticated inserts.

---

## 5. Exact changes and migration

**Migration:** `supabase/migrations/627_ledger_posting_security.sql` (additive, after 626).

### 5.1 `post_journal_entry`

- Removed the `auth.uid() IS NOT NULL` skip. Anonymous/unauthorized direct calls are now
  rejected.
- Added a trusted direct-database-session bypass only when there is no application JWT
  (`auth.role() = ''`, `auth.uid() IS NULL`) and `session_user` is `postgres`/`supabase_admin`.
  This preserves migrations/jobs without allowing `SET ROLE anon` with anon claims.
- Added line-account tenant validation: every `account_id` must belong to the posting
  business and be active (`LEDGER_POSTING_ACCOUNT_INVALID`).
- Added actor-spoofing checks for direct authenticated callers:
  `p_created_by` and `p_posted_by_accountant_id` must match `auth.uid()`
  (`LEDGER_POSTING_ACTOR_FORBIDDEN`).
- Hardened `search_path` to `public, pg_catalog`.
- Preserved adjustment, backfill, period-lock, revenue-recognition and balancing rules.

### 5.2 `post_wht_remittance_to_ledger`

- `SECURITY DEFINER`, `search_path = public, pg_catalog`.
- Locks the remittance row with `FOR UPDATE`.
- Returns the existing `journal_entry_id` when already linked.
- Updates the link only when it is still `NULL`; a concurrent link raises instead of
  repointing.
- Revoked from `PUBLIC`, `anon` and `authenticated`; granted only to `service_role`.

### 5.3 `post_journal_entry_with_request_metadata`

- Internal-only: revoked from `PUBLIC`, `anon` and `authenticated`; granted to `service_role`.
- Added a service-role/direct-owner guard because the wrapper accepts a caller-supplied actor
  UUID.

### 5.4 Shared ledger table guard

`finza_assert_ledger_write_authorized` now:

- allows service-role and trusted direct database sessions with no application JWT;
- rejects `anon` and `NULL` `auth.uid()`;
- bypasses only for nested trigger-driven postings (`pg_trigger_depth() > 1`);
- otherwise requires full accounting-write authority
  (`finza_assert_accounting_write_authorized(..., 'professional')`).

### 5.5 Function grants

- Revoked `PUBLIC`/`anon` execute from every direct journal writer and posting RPC in the
  audited set.
- Retained `authenticated` execute only for application-facing RPCs.
- Made WHT remittance, metadata posting, internal payroll helpers, Paystack settlement,
  cleanup/repair functions and trigger functions service-role-only.
- All changes are idempotent (`CREATE OR REPLACE`, `REVOKE`, `GRANT`).

---

## 6. Security model after correction

| Caller context | Journal posting result |
|---|---|
| `anon` / PostgREST anon JWT | Denied by function ACL and, if reached, by the guard |
| Authenticated non-member | Denied (`LEDGER_POSTING_FORBIDDEN`) |
| Authenticated staff/manager | Denied (`LEDGER_POSTING_PERMISSION_DENIED`) |
| Read-only accountant | Denied (`LEDGER_POSTING_READ_ONLY`) |
| Locked/expired subscription | Denied (`LEDGER_POSTING_SUBSCRIPTION_READ_ONLY`) |
| Cross-tenant account IDs | Denied (`LEDGER_POSTING_ACCOUNT_INVALID`) |
| Actor spoofing | Denied (`LEDGER_POSTING_ACTOR_FORBIDDEN`) |
| Authorized owner/admin/accountant | Allowed |
| Service role / trusted internal RPC | Allowed |
| Trigger-driven invoice/bill/payment/expense/retail posting | Allowed |
| Direct database owner session with no JWT | Allowed (trusted migration/job context) |
| Client calling internal WHT/metadata helper | Denied by ACL |

Residual trust boundary: a role with a direct database connection and `set_config` privileges
could spoof the `service_role` GUC. The correction assumes direct database credentials are
restricted to trusted operators; the client-facing PostgREST path is secured.

---

## 7. Negative authorization tests

Run by `supabase/tests/database/ledger_posting_security_627.test.js` and the SQL ACL test.

| Test | Expected | Actual | Result |
|---|---|---|---|
| Anonymous `post_journal_entry` | Denied | `permission denied for function post_journal_entry` | Pass |
| Anonymous `post_wht_remittance_to_ledger` | Denied | `permission denied for function post_wht_remittance_to_ledger` | Pass |
| Anonymous metadata wrapper | Denied | `permission denied for function post_journal_entry_with_request_metadata` | Pass |
| Anonymous `post_adjustment_to_ledger` | Denied | `permission denied for function post_adjustment_to_ledger` | Pass |
| Non-member posting | Denied | `LEDGER_POSTING_FORBIDDEN` | Pass |
| Read-only accountant | Denied | `LEDGER_POSTING_READ_ONLY` | Pass |
| Staff member | Denied | `LEDGER_POSTING_PERMISSION_DENIED` | Pass |
| Cross-tenant accounts | Denied | `LEDGER_POSTING_ACCOUNT_INVALID` | Pass |
| Actor spoofing | Denied | `LEDGER_POSTING_ACTOR_FORBIDDEN` | Pass |
| Invalid posting source | Denied | `posting_source must be 'system' or 'accountant'` | Pass |
| Locked subscription | Denied | `LEDGER_POSTING_SUBSCRIPTION_READ_ONLY` | Pass |

The SQL ACL test also verifies that `anon` has no execute privilege on all three
`post_journal_entry` overloads, the WHT writer, the metadata wrapper, or the audited direct
journal writers, and that internal-only functions are not authenticated-callable.

---

## 8. Positive accounting workflow tests

| Workflow | Evidence | Result |
|---|---|---|
| Authorized accountant direct journal | Integration test posted successfully | Pass |
| Authorized owner direct journal | Integration test posted successfully | Pass |
| Service-role journal posting | Integration test posted successfully | Pass |
| Service-role metadata wrapper | Integration test posted successfully | Pass |
| WHT remittance idempotency | Two calls returned the same journal; exactly one journal row | Pass |
| Concurrent WHT remittance | Two sessions; second blocked on row lock and reused the first journal | Pass |
| Unbalanced posting rollback | Balance error; zero journal rows | Pass |
| VAT return/payment integrity | `vat_return_integrity_618.test.sql` | Pass |
| WHT payment/remittance integrity | `wht_remittance_619.test.sql` | Pass |
| VAT taxable bases | `vat_taxable_bases_620.test.sql` | Pass |
| Authorization/overlap integrity | `tax_authorization_overlap_621.test.sql` | Pass |
| FX/retail VAT bases | `vat_taxable_bases_fx_622.test.sql`, `vat_retail_classification_622.test.sql` | Pass |
| FX/cumulative WHT | `wht_fx_cumulative_623.test.sql` | Pass |
| VAT mapping/adjustments | `vat_payment_mapping_adjustments_624.test.sql` | Pass |
| VAT amendments/reversals | `vat_return_amendments_625.test.sql` | Pass |
| Invoice material fulfilment | `invoice_material_fulfilment.test.sql` (NOTICE: tests PASS count=11) | Pass |
| WHT payable 2150 | `wht_payable_589.test.sql` (NOTICE: WHT Payable 2150 tests passed) | Pass |
| Focused tax/security Jest | 40 suites, 285 passed, 3 skipped | Pass |
| TypeScript | `npx tsc --noEmit` | Pass |

### Unverified / pre-existing failures

The following were run and failed identically on a baseline clone containing migrations
618–626 **without** 627, so they are not caused by this correction:

- `invoice_material_fulfilment_return_undo.test.sql` — `REVERSAL_ALREADY_EXISTS` (pre-existing).
- `service_manual_journals.test.sql` — asserts `anon` cannot execute
  `create_service_manual_journal_draft`; pre-existing grant failure.
- `bill_material_inventory_posting.test.sql` — `function_has_unsupported_header_discount_guard failed`
  (pre-existing function-shape failure).
- Payroll SQL tests — missing `digest(text, unknown)` (pgcrypto not installed in the clone) and
  pre-existing table-grant failures.
- `app/api/accounting` Jest suites (periods, opening balances, reconciliation) — 14 suites
  fail with pre-existing harness errors such as `supabase is not defined`.
- `npm run ci:accounting` — the accounting-invariant audit fails on existing production test
  data (opening-balance/rollforward and balance-sheet violations). The static
  `ci:detect-bypass` and `ci:detect-non-ledger` checks pass.
- Playwright E2E was not executed (no authenticated server/credentials).

Payroll, asset disposal/depreciation, CIT payment and service-intent posting were not fully
integration-tested in this task; their grants and internal guards were preserved, but they
remain **unverified** pending a staging run.

---

## 9. Migration results on both isolated clones

| Check | Schema clone (`finza_tax_test`) | Production-data clone (`finza_tax_data_test`) |
|---|---|---|
| Migration 627 applies | Pass | Pass |
| Re-applies idempotently | Pass | Pass |
| Existing journal count unchanged | 1,004 entries / 3,606 lines | 1,004 entries / 3,606 lines |
| Existing invoices/bills/VAT/WHT unchanged | 304 / 33 / 12 / 2 | 304 / 33 / 12 / 2 |
| `anon` execute on journal writers | None | None |
| `authenticated` execute on WHT/metadata | None | None |
| `service_role` execute on internal helpers | Yes | Yes |
| Security ACL SQL test | Pass | Pass |
| Role-based security test | Pass | Pass |
| WHT concurrency test | Pass | Pass |
| FINZA-TAX-FIX-02 SQL tests (9) | Pass | Pass |

The migration contains no DML against financial tables. The only `UPDATE` statement is inside
the WHT function body and executes only when the function is called.

---

## 10. Deployment compatibility and recovery

- **Order:** apply after migration 626. The migration is additive and does not depend on
  application code changes.
- **Schema cache:** after applying to staging/production, reload the PostgREST schema cache
  (`NOTIFY pgrst, 'reload schema'`) if the platform does not reload automatically.
- **Rollback:** restore the previous function bodies and grants from migrations 374/598 and
  the pre-627 ACLs. Do not restore the `PUBLIC`/`anon` grants as a permanent fix; rollback is
  for a bounded incident window only.
- **Monitoring:** watch for `42501`, `LEDGER_POSTING_*`, `permission denied for function`
  and `permission denied for table` errors by RPC name after deployment.
- **No production data changes:** the migration does not rewrite, delete or backfill
  financial records.

---

## 11. Staging-readiness assessment

**Ready for staging verification.**

- The anon ACL and function-guard exposure is closed.
- Authorized owner/accountant/service-role posting works in isolated tests.
- VAT/WHT/payment/invoice/bill/expense/credit-note/retail posting paths retain their grants
  and trigger-driven execution.
- Existing tax SQL tests pass on both clones.
- Remaining staging work: run the unverified payroll/asset/CIT/service-intent workflows, run
  authenticated E2E, and monitor permission errors.

## 12. Production-readiness assessment

**Not production-ready until staging verification is complete.**

The critical anon/unauthorized posting path is corrected and verified in isolation. Production
release still requires:

1. Staging application of migration 627 and schema-cache reload.
2. Authenticated E2E and payroll/asset/CIT/service-intent posting verification.
3. Confirmation that direct database credentials are restricted to trusted operators (the
   residual `set_config` trust boundary).
4. Resolution or explicit acceptance of the pre-existing test failures listed in §8.
5. A separately authorized production change window and rollback plan.

---

## 13. Result table

| Test | Expected | Actual | Result |
|---|---|---|---|
| Anonymous journal execution | Denied | `permission denied for function post_journal_entry` | Pass |
| Anonymous WHT posting | Denied | `permission denied for function post_wht_remittance_to_ledger` | Pass |
| Cross-tenant posting | Denied | `LEDGER_POSTING_ACCOUNT_INVALID` | Pass |
| Authorized internal journal posting | Allowed | Owner, accountant and service-role postings succeeded | Pass |
| VAT/WHT payment posting | Allowed when authorized | FINZA-TAX-FIX-02 VAT/WHT SQL tests pass; WHT idempotent | Pass |
| Duplicate WHT posting | Prevented | Two sequential and two concurrent calls returned one journal | Pass |
