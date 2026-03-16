# AUDIT + FIX TASK — Accounting Firm Contact Email Contract Drift

**GOAL:** Resolve schema ↔ API contract mismatch for firm contact email. Solve architecturally; no local patches.

**CONSTRAINT:** Do not implement until audit confirms correct source of truth.

---

## 1. Schema Audit Results

### 1.1 Current `accounting_firms` schema (from migrations)

| Source | Columns |
|--------|---------|
| **142_accounting_firms_step8_1.sql** (create) | id, name, created_by, created_at, updated_at |
| **145_firm_onboarding_status_step8_8.sql** | + onboarding_status, onboarding_completed_at, onboarding_completed_by, legal_name, jurisdiction, reporting_standard, default_accounting_standard |
| **275_accounting_firms_visible_to_engaged_clients.sql** | + **contact_email TEXT** (ADD COLUMN IF NOT EXISTS) |

**Current canonical schema (post-migrations):**  
id, name, created_by, created_at, updated_at, onboarding_status, onboarding_completed_at, onboarding_completed_by, legal_name, jurisdiction, reporting_standard, default_accounting_standard, **contact_email**

### 1.2 Did `contact_email` ever exist?

**Yes.** It was introduced in migration **275**:

- `ALTER TABLE accounting_firms ADD COLUMN IF NOT EXISTS contact_email TEXT;`
- `COMMENT ON COLUMN accounting_firms.contact_email IS 'Optional contact email shown to clients (partner sets in firm settings).';`

It was **not** renamed or removed in any later migration. Migrations 279, 280, 281 only change RLS policies on `accounting_firms`; they do not touch the column list.

### 1.3 If the live DB does not have `contact_email`

Then either:

- Migration **275** has not been applied in that environment, or  
- The column was dropped or the table recreated outside the migration chain (e.g. manual change or older DB clone).

In the **repository’s migration history**, `contact_email` exists and is the only firm-level “contact email” field.

### 1.4 Where else could “firm email” live?

| Location | Relevant fields | Notes |
|----------|------------------|------|
| **accounting_firms** | contact_email (275) | Intended “optional contact email shown to clients”. |
| **accounting_firms** | created_by | UUID → auth.users(id). Auth has email; not exposed in public schema. |
| **accounting_firm_users** | firm_id, user_id, role | Links firm to users (partner/senior/junior/readonly). No email column. |
| **auth.users** | email | Supabase Auth; accessible only via Auth API / service role, not in public RLS. |
| **public.users** (051) | id, email, full_name (if present) | If this table exists and has email, firm contact could be derived via created_by or a partner user_id. |
| **No separate firm profile table** | — | No `accounting_firm_profile` or similar in migrations. |

**Conclusion:** In schema, firm contact email is **only** defined as `accounting_firms.contact_email`. There is no other dedicated “firm contact email” column. Derivation would have to come from a user (e.g. created_by or a designated partner) via Auth or a public users table.

---

## 2. Data Ownership Model Analysis

**Question:** Where should firm contact email canonically live?

| Option | Description | Reasoning |
|--------|--------------|-----------|
| **A) accounting_firms** | Single optional contact email on the firm row. | Aligns with migration 275 and current API contract. One place for “firm contact” for clients. Partners can set a shared inbox or primary contact. Simple for RLS (already on firm). |
| **B) accounting_firm_users (partner/owner user email)** | No firm column; resolve contact from a user (e.g. first partner) and that user’s email (Auth or public users). | Avoids duplication with Auth; single source (user email). But: requires join/API to Auth or users; “which user is the contact?” (first partner? created_by?); multi-partner firms may want a shared address; Auth email is identity, not necessarily “contact for clients”. |
| **C) Separate accounting_firm_profile table** | New table with firm_id, contact_email, etc. | Normalizes “profile” vs “entity”; allows more profile fields later. Adds table, join, and RLS; migration 275 already chose the firm row. |
| **D) users table linked via role** | Contact = email of a user linked via accounting_firm_users (e.g. partner). | Same as B in practice: derive from user. |
| **E) Other** | e.g. firm_settings JSONB on accounting_firms. | Flexible but weak typing and no single canonical field for “contact email”. |

**Finza architecture context:**

- **Firm identity:** Firm is the entity (accounting_firms); created_by and accounting_firm_users define who belongs. RLS is firm-centric (policies on firms, engagements, etc.).
- **Multi-user firms:** Multiple partners/seniors. A single “firm contact email” (e.g. info@firm.com) is a common need for client-facing display; it does not have to be a specific user’s email.
- **RLS:** Contact email is shown to clients (business owners) when they have an engagement (pending/active). Visibility is already “can they see this firm row?”; adding contact_email on the same row does not change RLS.
- **Invitations / marketplace:** Service invitations show firm name and contact so the owner can reach the firm. A dedicated firm-level contact (A or C) is stable; deriving from a user (B/D) ties display to “which user we pick” and user email changes.

**Conclusion:** Canonical storage for “firm contact email shown to clients” fits **A) accounting_firms.contact_email** (or C if we later want a full profile table). The repo and migration 275 already treat it as A.

---

## 3. Usage Map

All code that references `accounting_firms.contact_email` or the API contract `firm_contact_email`:

| File | Purpose | Required data |
|------|---------|----------------|
| **app/api/service/invitations/route.ts** | Builds firm map and response for Service invitations. | Selects `id, name, contact_email` from accounting_firms. Maps to `firm_contact_email` in pending/active items. |
| **app/service/invitations/page.tsx** | Renders pending/active invitations. | Types PendingItem / ActiveItem with `firm_contact_email?: string \| null`. Renders it under firm name when present. |

No other files in the repo select `contact_email` from `accounting_firms` or use `firm_contact_email`. Other firm usage:

- **lib/firmOnboarding.ts** — selects onboarding fields only (no contact_email).
- **app/api/accounting/firm/firms/route.ts** — selects `id, name` only.
- **app/api/firm/accounting-clients/route.ts** — selects `onboarding_status, name` only.
- **app/accounting/firm/setup/page.tsx** — insert uses name, created_by only.
- **app/api/accounting/firm/onboarding/complete/route.ts** — update uses onboarding fields only.

So the **only** consumer of firm contact email is the **Service invitations** flow (API + page).

---

## 4. Contract Consistency Review

**Does the invitations API contract require `firm_contact_email`, or should it be derived?**

- **Current contract:** API returns pending/active items with `firm_contact_email` from `accounting_firms.contact_email` (nullable). UI shows it when present.
- **Stability:** A column on the firm row is stable; no dependency on “which user” or Auth. Same firm row is already loaded for name and RLS.
- **Data duplication:** contact_email is firm-level, not a copy of a user email unless the partner chooses to set it that way. So duplication is optional and explicit.
- **Multi-partner:** One shared contact (e.g. info@firm.com) is simpler than picking one partner’s email. If we derived from a user, we’d need a rule (e.g. “first partner by created_at”) and would have to maintain it.
- **Marketplace / invitations:** Client needs “how to contact this firm”. A single optional firm field matches that; derivation from a user is possible but adds complexity and ambiguity.

**Conclusion:** The invitations API contract **should** be backed by a single canonical firm-level field. That matches **Option A** (contact_email on accounting_firms). Deriving from a partner user (B) is possible but less stable and not required for the current design.

---

## 5. Canonical Architecture Decision

### Option A: Add / keep `contact_email` on `accounting_firms`

- **Pros:** Single source of truth; matches migration 275 and current API; simple RLS (no new tables); one place for “firm contact for clients”; supports shared inbox.
- **Cons:** If DB never had 275 applied, a migration (or re-apply) is needed; partners must set it (or it stays null).
- **RLS:** No change; column is just another selected field.
- **Migration:** Ensure column exists (ADD COLUMN IF NOT EXISTS); optional backfill from created_by → auth/users if desired (out of scope for “add column”).
- **Scalability:** Fine for marketplace; can add more firm profile fields later on same table or a profile table.

### Option B: Derive from firm owner/partner user

- **Pros:** No new column; uses existing user email (Auth or public users).
- **Cons:** Need a defined rule (e.g. created_by or first partner); requires join + Auth or users table; user email is identity, not necessarily “contact for clients”; multi-partner and “shared contact” are awkward.
- **RLS:** Must expose firm → user → email in a way that respects RLS and Auth.
- **Migration:** No schema change; API/backend logic change to resolve email per firm.
- **Scalability:** Tied to user identity; less flexible for “firm” contact.

### Option C: Create `accounting_firm_profile` table

- **Pros:** Separates “firm entity” from “firm profile”; room for more profile fields.
- **Cons:** New table, join, RLS, and migration; 275 already put contact_email on the firm; overkill for one optional field today.
- **RLS:** New policies for profile table (e.g. same visibility as firm).
- **Migration:** New table, backfill, API to read from profile.
- **Scalability:** Good if we expect many profile attributes.

### Option D: Other (e.g. firm_settings JSONB)

- **Pros:** Flexible.
- **Cons:** No typed contract; harder to index/query; comment in 275 explicitly documents contact_email as a column.
- **Not recommended** for a single canonical contact email.

---

### Final recommendation: **Option A**

- **Canonical model:** Firm contact email is stored in **accounting_firms.contact_email** (TEXT, nullable).
- **Reasoning:** Migration 275 already defined it; API and UI expect it; RLS is unchanged; one clear place for “contact email shown to clients”; supports multi-partner and shared inbox; no derivation rule or Auth dependency.
- **If the column is missing in a given DB:** Treat as schema drift; (re-)apply the 275 column addition (or a small migration that ensures the column exists). Do not “fix” by commenting out the field or deriving elsewhere without an explicit product decision to move the source of truth.

---

## 6. Migration Strategy (after decision — no code implementation)

Apply only after confirming Option A as the chosen architecture.

### 6.1 Schema

- **Ensure column exists:** Run `ALTER TABLE accounting_firms ADD COLUMN IF NOT EXISTS contact_email TEXT;` (same as 275).
- **Comment:** `COMMENT ON COLUMN accounting_firms.contact_email IS 'Optional contact email shown to clients (partner sets in firm settings).';`
- **No drop, no rename:** Do not remove or rename contact_email in this fix.

### 6.2 Data backfill

- **Optional:** If product wants to backfill from “firm creator’s email”, a one-off or migration can set `contact_email` from Auth/users using `created_by`. Not required for contract alignment; only for UX.
- **Default:** Leave existing rows as NULL; partners set contact email in firm settings when available.

### 6.3 RLS

- No change. contact_email is a column on accounting_firms; existing SELECT policies (firm members, clients with engagement) already govern row visibility.

### 6.4 API contract

- **Invitations API:** Keep selecting `id, name, contact_email` from accounting_firms and returning `firm_contact_email` (from contact_email). No change to contract; ensure DB has the column so the select does not fail or omit the field.
- **Firm settings (if any):** Add or expose a way for partners to UPDATE accounting_firms.contact_email; RLS (e.g. “Partners can update firm onboarding details”) may already allow partner updates; confirm UPDATE policy includes contact_email or that it is allowed by existing policy.

### 6.5 Rollback

- **Rollback of “ensure column”:** If the column was missing and we add it, rollback would be `ALTER TABLE accounting_firms DROP COLUMN IF EXISTS contact_email;`. Only safe if no code or other migrations depend on the column; given API already expects it, rollback would require API change to stop selecting it.
- **No rollback of 275 in full:** 275 also adds RLS policy; do not roll back the whole migration. Only the contact_email column is in scope for this fix.
- **Safe approach:** Treat “ensure column exists” as additive; avoid dropping contact_email unless retiring the feature.

---

## Summary

| Item | Result |
|------|--------|
| **Schema** | contact_email exists in migration 275 on accounting_firms; not removed later. If missing in DB, 275 was not applied or schema was changed outside migrations. |
| **Data ownership** | Recommended: **accounting_firms.contact_email** (Option A). |
| **Usage** | Only Service invitations API and page use firm contact email. |
| **Contract** | Invitations API should keep using a single firm-level contact email (Option A). |
| **Canonical decision** | **Option A** — keep/add contact_email on accounting_firms. |
| **Migration** | Ensure column exists (275 or equivalent); optional backfill; no RLS change; keep API contract; rollback = drop column only if API is adjusted. |

**Do not implement** until the architecture (Option A) is confirmed. Then proceed with migration strategy only (schema + optional backfill + API/settings check), without local quick-fixes or silent fallbacks.
