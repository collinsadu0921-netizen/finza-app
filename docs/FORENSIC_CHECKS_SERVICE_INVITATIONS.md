# Forensic Checks: Service Invitations (/service/invitations)

**Date:** Pre-implementation. **Mode:** Read-only findings.

---

## 1) `app/api/service/accountant/pending-engagements/route.ts`

- **Exists?** **No.** No file at this path. No directory `app/api/service/accountant/`.
- **Action:** New API will be `GET /api/service/invitations` (per spec).

---

## 2) `app/service/accountant/page.tsx`

- **Exists?** **No.** No file at this path. No directory `app/service/accountant/`.
- **Action:** New page will be `app/service/invitations/page.tsx` (per spec).

---

## 3) `app/api/accounting/firm/engagements/[id]/route.ts` (PATCH)

- **Exists?** **Yes.**
- **PATCH actions:** `accept` | `reject` | `suspend` | `resume` | `terminate`.
- **Accept:** Requires `isBusinessOwner` (business.owner_id === user.id); else 403 "Only business owners can accept engagements". Sets status to `accepted`, sets `accepted_at` and `accepted_by`.
- **Reject:** Same owner guard; 403 "Only business owners can reject engagements". Sets status to `terminated`.
- **Pending guard:** Only pending engagements can be accepted/rejected (400 otherwise).
- **Conclusion:** No changes needed. Use as-is for Accept/Reject.

---

## 4) `lib/serviceBusinessContext.ts`

- **Exists?** **Yes.**
- **Export:** `resolveServiceBusinessContext(supabase, userId)`.
- **Returns:** `{ businessId: string }` when user is owner (business.owner_id = userId) or has business_users membership on a claimed business (owner_id IS NOT NULL); else `{ error: "NO_CONTEXT" }`.
- **Conclusion:** Use for resolving current service business in invitations API and page.

---

## 5) RLS: firm_client_engagements and accounting_firms (owners)

- **firm_client_engagements**
  - **SELECT (146):** "Business owners can view their business engagements" — USING (businesses.id = client_business_id AND businesses.owner_id = auth.uid()). **Owners can read all engagements for their business (any status).**
  - **UPDATE (277):** "Business owners can update their business engagements" — same USING/WITH CHECK. **Owners can accept/reject (update status).**
- **accounting_firms**
  - **SELECT (275, 279):** "Clients can view firm with active engagement" — USING (EXISTS (fce where client_business_id = owner's business AND accounting_firm_id = accounting_firms.id AND **fce.status IN ('accepted','active')** AND date range)). **Owners can read firm only when engagement is effective (accepted/active).**
  - **Gap:** For **pending** invitations, owner cannot SELECT accounting_firms (no policy for pending). So we cannot join to get firm name for pending engagements with RLS alone.
- **Action:** Add migration: policy so owners can SELECT accounting_firms when they have **any** engagement (including pending) with that firm. Then invitations API can return firm name/contact_email for both pending and active.

---

**Summary:** API and page for accountant pending/active do not exist. PATCH and serviceBusinessContext are correct. RLS needs one additional SELECT policy on accounting_firms for owners with any engagement (pending or effective) so firm name can be returned for pending invitations.
