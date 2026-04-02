# Service team roles, project APIs, and audit log

## Root cause: “Job not found” when cancelling a project (manager)

**Cause:** Server routes used `getCurrentBusiness()`, which **cannot read** the client’s workspace selection (`localStorage` / `finza_selected_business_id`). For users in **more than one** business (e.g. owner of A + manager of B), the API often picked the **wrong** `business_id`, so the job row was queried under another tenant → **404 “Job not found”**.

**Fix (app):**

- `POST /api/service/jobs/[id]/cancel?business_id=…` resolves scope with `resolveBusinessScopeForUser`.
- `POST /api/service/jobs/use-material` resolves scope from **body** `business_id` first (not “current business” then compare).
- `PATCH /api/service/jobs/usage/[id]` accepts **body** `business_id` and resolves scope the same way.
- Project detail page sends `business_id` on cancel and usage PATCHes.

**Fix (DB):** Migration `409_service_inventory_rls_owner_or_member.sql` changes service inventory / job RLS from **business_users only** to **`finza_user_can_access_business`** (owner **or** team member). Previously, a **pure owner** with no `business_users` row could not see `service_jobs` via the browser client even for their own business.

---

## Audit log: why manager actions seemed missing

**1. Nothing was logged** for many service job mutations (cancel, allocate material, consume/return usage). Those flows did not call `logAudit`.

**Fix:** The routes above now write audit rows, e.g.:

| `action_type` | When |
|---------------|------|
| `service_job.cancelled` | Project cancelled |
| `service_job.material_allocated` | Material allocated to job |
| `service_job.material_consumed` | Usage marked consumed |
| `service_job.material_returned` | Usage returned |
| `service_job.material_usage_updated` | Other allowed status changes |

**2. Wrong business on list API** — `/api/audit-logs/list` also used `getCurrentBusiness()`, so logs for the selected workspace could be missing or empty.

**Fix:** List API accepts `business_id` (aligned with workspace). `/audit-log` page and `ActivityHistory` pass `getSelectedBusinessId()`.

**3. Permission to view logs** — Previously only **owner** or **`accounting.view`**. Default **manager** has **`reports.view`** but not **`accounting.view`**, so they got **403** on the audit API.

**Fix:** Non-owners may list audit logs if they have **`reports.view`** or **`accounting.view`**.

**Already logged (examples):** Service team invite/update/remove (`team.member_*` via `/api/service/team/*`). Many other areas (invoices, POS, etc.) log selectively; not exhaustive.

---

## Role defaults vs service UI (summary)

Source: `lib/permissions.ts` → `ROLE_DEFAULTS`.

| Role | Service-relevant permissions (non-exhaustive) | Gaps / notes |
|------|-----------------------------------------------|--------------|
| **Owner** | All permissions | — |
| **Admin** | All by default | — |
| **Manager** | `jobs.*`, customers/invoices/estimates (view/create), `reports.view`, `team.manage`, `staff.manage`, expenses, etc. | No `accounting.view` / `accounting.reconcile` unless granted. Can view audit log via **`reports.view`** after this change. |
| **Accountant** | Narrower doc/financial read; bills create | May lack `jobs.create`; check custom permissions for ops. |
| **Employee** | Mostly view + limited create | Often no `jobs.create` / `team.manage`. |

**Important:** App APIs for jobs **do not** consistently enforce `hasPermission(..., "jobs.update")` — **RLS** on `service_jobs` allows any team member (or owner after migration 409). Tightening would mean adding permission checks on each route.

---

## Follow-ups (not done here)

- Add `logAudit` (or DB triggers) for **direct Supabase** edits on the job detail page (e.g. inline `service_jobs` update, proforma link) if those should appear in `audit_logs`.
- Extend audit coverage to **materials list**, **proforma** actions, and other service-only mutations as needed.
- Consider a dedicated **`audit.view`** permission instead of overloading **`reports.view`**.
