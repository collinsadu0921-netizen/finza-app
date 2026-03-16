# Journal Entry Reversal — Who Is Allowed (Audit Report)

**Scope:** Who is currently allowed to reverse a journal entry in FINZA, and what was the original intended restriction.  
**Audit only — no fixes.**

---

## AUDIT 1 — Reversal API route access control

**File:** `app/api/accounting/reversal/route.ts`

### 1. Is there any role check before the reversal is posted?

**Yes.** After loading the original journal entry and resolving `business_id`, the route calls:

```ts
const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "write")
if (!authResult.authorized) {
  return NextResponse.json(
    { error: "You do not have permission to reverse journal entries for this business." },
    { status: 403 }
  )
}
```

There is no use of `getAccountingAuthority` by name in this file; the only authority check is `checkAccountingAuthority(..., "write")`.

### 2. If a role check exists — what roles are allowed?

**Exact condition:** `checkAccountingAuthority(supabase, user.id, businessId, "write")` must return `authorized: true`.

From `lib/accountingAuth.ts` that means:

- **Owner** — always authorized (authority_source = `"owner"`).
- **Admin or accountant** (business_users role) — authorized for write **unless** `isUserAccountantReadonly(supabase, userId, businessId)` is true; if readonly, not authorized for write.
- **Firm user** — authorized only if `getAccountingAuthority({ supabase, firmUserId, businessId, requiredLevel: "write" })` returns `allowed: true` (engagement effective and access_level satisfies "write").

So **allowed to reverse:** owner; admin; accountant (non–readonly); firm user with write (or higher) on the engagement.  
**Not allowed:** unauthenticated; user with no relationship to the business; accountant_readonly; firm user with read-only or no engagement.

### 3. If no role check existed — confirm any authenticated user with business_id could trigger reversal

**N/A.** A role check exists; without it, any authenticated user with a valid `business_id` (e.g. from another business they can access) could call the API with that business’s JE id. The current implementation prevents that by requiring write authority for that `business_id`.

### 4. Is there any check on WHAT type of entry can be reversed?

- **reference_type = 'reversal':** There is **no** explicit check that blocks reversing an entry whose `reference_type` is `'reversal'`. The only guard is: if a row already exists in `journal_entries` with `reference_type = 'reversal'` and `reference_id = original_je_id`, the API returns the existing reversal (double-reversal guard). So reversing a “reversal JE” itself is not explicitly blocked; it would be allowed as long as no other reversal already points to that JE.
- **reference_type = 'invoice' (or others):** No block or warning. Any posted JE (with ≥2 lines and in an open period) can be reversed regardless of `reference_type`. The route uses `reference_type`/`reference_id` only after posting the reversal JE (e.g. to soft-delete a payment when reversing a payment JE).

**Verdict:** 🔴 **ISSUE** — No restriction on *what* can be reversed (e.g. blocking or warning for `reference_type = 'reversal'` or `reference_type = 'invoice'`). Access control for *who* can reverse is present and correct (write authority).

---

## AUDIT 2 — RBAC roles in FINZA

### Where roles are defined

- **Business-scoped roles:** `lib/userRoles.ts` — `getUserRole(supabase, userId, businessId)` returns a single role from:
  - `businesses.owner_id === userId` → `"owner"`
  - else from `business_users`: `data.role` (admin, manager, cashier, employee, accountant per migration 085; owner is not in business_users for the same business).
- **Accounting authority (who can do what):** `lib/accountingAuth.ts` — uses `getUserRole`, `isUserAccountantReadonly`, and `lib/accountingAuthorityEngine.ts` for firm path.
- **Firm roles:** `accounting_firm_users.role` (partner, senior, junior, readonly — migration 142); `firm_client_engagements.access_level` (read, write, approve).

### All roles that exist

| Source | Roles |
|--------|--------|
| **Business (owner)** | `owner` — from `businesses.owner_id`. |
| **Business (business_users)** | `admin`, `manager`, `cashier`, `employee`, `accountant` (constraint in 085). Plus flag `accountant_readonly` on business_users. |
| **Firm (accounting_firm_users)** | `partner`, `senior`, `junior`, `readonly`. |
| **Engagement (firm_client_engagements)** | `access_level`: `read`, `write`, `approve`. |

There is no separate role name like `firm_accountant`; firm users are “accountant” in the sense of `authority_source === "accountant"` when they get access via `getAccountingAuthority`.

### Per-role accounting capabilities

| Role | In accounting |
|------|----------------|
| **owner** | Full: read and write (including reversal, manual journal, period close/lock). Not subject to accountant_readonly. |
| **admin** | Treated like employee in accountingAuth; gets read and write (including reversal) unless not applicable. No explicit accounting-only block. |
| **accountant** | Read and write; write blocked if `accountant_readonly === true`. Can reverse, post manual journals, close/lock periods (subject to API checks). |
| **accountant_readonly** | Explicitly blocked from write in `checkAccountingAuthority`: when accessLevel is "write", result stays unauthorized. So: view ledger/reports, no reverse/post/close. |
| **manager, employee, cashier** | Not granted accounting authority in `accountingAuth.ts` (only owner, admin, accountant, or firm path). So no access to accounting APIs that use `checkAccountingAuthority` unless they are also firm users for that business. |
| **Firm (partner/senior/junior/readonly)** | Access via engagement `access_level`. read → view only; write → post/reverse etc.; approve → can approve period close and, in UI, reverse (see Audit 3). |

### Explicit blocks

- **accountant_readonly:** Blocked from write (reversal, manual journal post, period close/lock) in `checkAccountingAuthority`.
- **Firm user with engagement access_level = read:** Not allowed write or approve; reversal and period close/lock APIs would return 403 (write or approve required).
- **Non-owner, non-admin, non-accountant, non-firm:** No row in business_users with admin/accountant and no firm engagement → `checkAccountingAuthority` denies.

**Verdict:** 🟢 **CLEAN** — Roles and accounting authority are clearly defined; accountant_readonly and engagement access_level are enforced in the auth layer.

---

## AUDIT 3 — General Ledger UI — Reverse button visibility

**File:** `components/accounting/screens/LedgerScreen.tsx`

### 1. Is the Reverse button conditionally shown based on role?

**Yes.** The Reverse button is enabled only when both:

- **Engagement guard:** `canReverseByEngagement` is true.
- **Per-entry guard:** `canReverse` from `/api/accounting/reversal/status` is true for that entry.

`canReverseByEngagement` is defined as:

```ts
const canReverseByEngagement =
  authSource !== "accountant" || canApproveEngagement(engagementAccessLevel)
```

From `lib/accounting/uiAuthority.ts`, `canApproveEngagement(accessLevel)` is true when `access_level === "approve"`. So:

- If **authority_source** is **owner** or **employee** (admin/accountant at business): `authSource !== "accountant"` is true → Reverse is allowed (subject to status API).
- If **authority_source** is **accountant** (firm): Reverse is allowed only when **access_level** is **"approve"** (not just "write").

The button is not hidden; it is **disabled** when `!canReverseByEngagement || !canReverse`, with tooltips: “Requires approve engagement access” or the status reason (e.g. “This entry has already been reversed”, “Current period is closed…”).

### 2. Shown to all users who can view the ledger?

Anyone who can view the ledger (read authority) can see the Reverse button. For firm accountants with **read** or **write** (but not approve), the button is visible but disabled with “Requires approve engagement access”. So the UI is role-aware: show to all viewers, enable only for (owner/employee with write) or (firm with approve).

### 3. UI-level role guard on the reversal action

- **Click handler:** `openReversalModal` checks again: if `authSource === "accountant"` and `!canApproveEngagement(engagementAccessLevel)`, it sets `blockedActionMessage("Reverse journal requires approve engagement access")` and does not open the modal.
- **Submit:** The actual reversal is done by `POST /api/accounting/reversal`, which enforces `checkAccountingAuthority(..., "write")` and does not check approve. So a firm user with **write** but not **approve** could in theory call the reversal API directly and would get 403 only if the write check failed; in practice, for firm users, write and approve are both determined by engagement `access_level`, and the UI restricts the button to approve. So UI guard is consistent with “reversal requires approve for firm users”; API requires only write.

**Verdict:** 🟢 **CLEAN** — Reverse is conditionally enabled by role (owner/employee vs firm) and by engagement access_level (approve for firm). UI guard and tooltips are present.

---

## AUDIT 4 — Original intent from comments or docs

### Docs

- **docs/ACCOUNTING_REVERSAL_WORKFLOW.md**
  - “Accountants may reverse any posted journal entry subject to period and approval rules.”
  - Preconditions: “User has **accountant** (or equivalent) authority for the business.”
  - Approval: “Single accountant with write authority may reverse (subject to open period).”
  - So the intended restriction is: **accountant (or equivalent) with write authority**; no mention of “only approve” or “owner-only.”

- **docs/ACCOUNTING_CONTROL_SURFACE_IMPLEMENTATION.md**
  - Reversal: “guardrails (period open, not reversed, reason required)”; “Permissions: All surfaces gated by `checkAccountingAuthority` and existing admin checks; no new schema.”
  - No reversal-specific role beyond general accounting authority.

- **docs/ACCOUNTING_RISK_CONTROL_MATRIX.md**
  - “Reverse JE (open period)”: “Single accountant; mandatory reason; audit log.”
  - “Single accountant: Manual journal, adjustment, reversal…”

So the documented intent is: **accountant (or equivalent) with write authority** may reverse; no stricter “approve-only” or “owner-only” for reversal in these docs.

### Migrations

- No accounting-related migration was found that states “only X may reverse” or defines a reversal-specific permission. Reversal is implemented as a normal adjustment-style post with `reference_type = 'reversal'` and double-reversal guard.

### TODOs / FIXMEs near reversal logic

- In `app/api/accounting/reversal/route.ts`, the only comment block is “BUG 1 FIX” (payment soft-delete after reversing a payment JE). No TODO/FIXME about who should be allowed to reverse.

### lib/accountingAuth.ts

- No reversal-specific permission. Reversal uses the same `checkAccountingAuthority(..., "write")` as other write actions (e.g. manual journal post, period close). So the intended restriction is **write authority**, not a separate “reversal” permission.

**Verdict:** 🟢 **CLEAN** — Original intent is “accountant (or equivalent) with write authority”; implementation matches (write required; UI adds approve for firm users).

---

## AUDIT 5 — Other sensitive accounting actions (comparison)

| Action | Route / location | Current restriction |
|--------|-------------------|----------------------|
| **Lock period** (and close) | `app/api/accounting/periods/close/route.ts` | `checkAccountingAuthority(supabase, user.id, business_id, "write")`. Same as reversal: owner, admin, accountant (non-readonly), firm with write. Then firm path adds `resolveAuthority` / role checks for request_close / approve_close / reject_close. |
| **Post manual journal** | `app/api/accounting/journals/drafts/[id]/post/route.ts` | Owner-mode: `checkAccountingAuthority(..., "write")`. Firm-mode: onboarding + engagement + “approve” and firm role (e.g. partner) for posting. So manual journal post is **stricter** for firm (approve + role) than reversal API (reversal only requires write at API). |
| **View general ledger** | `app/api/ledger/list/route.ts` | `checkAccountingAuthority(supabase, user.id, businessId, "read")`. Any read authority: owner, admin, accountant (including readonly), firm with read. |
| **Run payroll** (create run, approve/post) | `app/api/payroll/runs/route.ts` (POST), `app/api/payroll/runs/[id]/route.ts` (PUT) | **No** `checkAccountingAuthority`. Uses `getCurrentBusiness(supabase, user.id)` only. So any user who has a “current business” (e.g. owner or first business in dev) can create runs and trigger post; no explicit accountant or role check. |

Pattern: **Reversal, lock period, and view ledger** use `checkAccountingAuthority` with write or read. **Manual journal post** uses the same for owner-mode and adds firm approve/role for firm-mode. **Payroll** does not use accounting authority and is more permissive (current-business only).

**Verdict:** 🟡 **UNCLEAR** — Reversal is aligned with lock period and view ledger (accounting authority). Manual journal post is stricter for firm users (approve). Payroll is an outlier (no accounting authority).

---

## Summary table

| Action | Current restriction | Should be (from docs/intent) |
|--------|---------------------|------------------------------|
| **Reverse JE** | Write authority: owner, admin, accountant (non-readonly), firm write. UI: firm needs “approve” to enable Reverse. | Accountant (or equivalent) with write; open period; reason required. ✅ Matches. |
| **Lock period** | Write authority (same as above); firm path adds resolveAuthority for request/approve/reject. | Accountants with write can close/lock. ✅ Matches. |
| **Manual journal** | Owner: write. Firm: onboarding + approve + role (e.g. partner). | Stricter than reversal at API for firm (approve required). ✅ Intentional per implementation. |
| **View ledger** | Read authority: owner, admin, accountant (any), firm read. | Read for accountants/equivalent. ✅ Matches. |
| **Run payroll** | Current business only (`getCurrentBusiness`); no checkAccountingAuthority. | Not defined in accounting docs; likely “business admin” or similar. 🟡 Unclear whether it should align with accounting write. |

---

## Conclusion

- **Who can reverse:** Anyone with **accounting write** for the business (owner, admin, non-readonly accountant, or firm user with write). For firm users, the ledger UI further requires **approve** to enable the Reverse button; the reversal API itself only requires write.
- **Original intent:** “Accountant (or equivalent) with write authority” may reverse; implementation and docs align.
- **Gap (Audit 1):** No check on **type** of entry (e.g. block or warn when reversing a `reference_type = 'reversal'` or `reference_type = 'invoice'`); only double-reversal and open-period checks exist.
- **Payroll** is the only sensitive action audited that does not use `checkAccountingAuthority`; whether it should be restricted to accounting write (or another role) is a product decision.
