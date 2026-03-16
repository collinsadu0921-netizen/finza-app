# Service Invitations (/service/invitations) — Deliverables

## Files created/edited

| File | Change |
|------|--------|
| `supabase/migrations/281_accounting_firms_visible_for_owner_engagements.sql` | **New.** RLS: owners can SELECT accounting_firms when they have any engagement (OR path; existing effective-engagement policy intact). |
| `app/api/service/invitations/route.ts` | **Updated.** Two-query flow: engagements then firm identity by id IN; no join that bypasses RLS. |
| `app/service/invitations/page.tsx` | **Updated.** Subtitle per spec; re-fetch on accept/reject success; "No business context." empty state; 401 → redirect to login; Active since / "Active" only. |
| `components/Sidebar.tsx` | **Unchanged.** Already has "Accountant Requests" → `/service/invitations` under SETTINGS (service). |

**Step 0 migration:** `281_accounting_firms_visible_for_owner_engagements.sql` adds one policy; it does not drop the existing "Clients can view firm with active engagement" policy. Both apply (OR). Apply migration with `supabase db push` or your usual migration flow to confirm success.

---

## Exact response JSON schema for GET /api/service/invitations

**Authenticated, with service context:**

```json
{
  "businessId": "uuid",
  "pending": [
    {
      "id": "uuid",
      "accounting_firm_id": "uuid",
      "firm_name": "string",
      "firm_contact_email": "string | null",
      "access_level": "string",
      "effective_from": "YYYY-MM-DD",
      "effective_to": "YYYY-MM-DD | null",
      "created_at": "ISO8601"
    }
  ],
  "active": [
    {
      "id": "uuid",
      "accounting_firm_id": "uuid",
      "firm_name": "string",
      "firm_contact_email": "string | null",
      "access_level": "string",
      "effective_from": "YYYY-MM-DD",
      "effective_to": "YYYY-MM-DD | null",
      "accepted_at": "ISO8601 | null"
    }
  ]
}
```

**No context (e.g. firm-only user, no business):** Same shape with `businessId: null`, `pending: []`, `active: []`. HTTP 200.

**Unauthorized:** `401` with `{ "error": "Unauthorized" }`.

---

## Verification checklist (PR description)

1. **Owner sees pending → Accept → moves to Active**  
   Owner has at least one engagement with `status = 'pending'`. Open `/service/invitations`. Accept one → it disappears from Pending and appears in Active (status accepted, accepted_at set). List is re-fetched.

2. **Reject → pending disappears**  
   With a pending engagement, Reject → confirm → it disappears from the list. List is re-fetched.

3. **Owner sees firm name for pending**  
   Confirms Step 0 / 281 policy: pending invitations show firm name (and contact_email when present).

4. **Non-owner / firm user**  
   User with no business (e.g. firm-only) visits `/service/invitations` → sees "No business context." or is redirected by existing access control; no client data.

5. **No build errors**  
   `npm run build` (or equivalent) passes.
