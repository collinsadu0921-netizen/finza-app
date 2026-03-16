# Audit + Fix: firm_id vs business_id (Accountant Workspace)

## Evidence

- **`/api/debug/accounting-authority?business_id=986a...`** returns `NO_ENGAGEMENT` and shows `firmIds=["986a..."]` → `986a...` is the **firm** id, not a business id.
- **SQL insert failure:** FK on `firm_client_engagements.client_business_id` referencing `businesses(id)`: `986a...` not present in `businesses`. So engagements were attempted with `client_business_id` set to the **firm** id.

## Correct IDs (reference)

| Role / Entity        | ID (prefix)   | Notes                    |
|----------------------|---------------|--------------------------|
| Firm user            | `cacc11ac-...`| User in firm             |
| Firm id              | `986a983e-...`| `accounting_firms.id`     |
| Client business "Ledger" | `8aa623a8-...` | `businesses.id`        |
| Owner of Ledger      | `8ffa97a0-...`| Business owner           |

Engagement creation must use:
- `accounting_firm_id` = `986a983e-...`
- `client_business_id` = `8aa623a8-...`
- `status` = `'pending'` (acceptance only via service PATCH by owner)
- `effective_from` = today (or as chosen)
- `accepted_at` = **not set** until status is accepted/active (DB trigger enforces).

---

## 1) Where firm_id and business_id could be confused

### Audited paths

| Location | Finding |
|----------|--------|
| **POST `/api/accounting/firm/engagements`** | Accepts `firm_id` and `business_id` from body and inserts `accounting_firm_id: firm_id`, `client_business_id: business_id`. If a **caller** (UI, script, or manual request) sends the firm id as `business_id`, the insert would use firm id as `client_business_id` → FK failure (businesses.id). **Root cause:** no server-side guard that `business_id` is not the firm. |
| **`app/accounting/firm/clients/add/page.tsx`** | Uses `getActiveFirmId()` for `firm_id` and `/api/businesses/search` for business list; sets `formData.business_id` from `business.id`. Search API queries **businesses** only → IDs are business ids. **No bug in this UI** if search is used as intended. Risk: if user or another client ever sent firm id as `business_id` (e.g. manual API call or wrong dropdown elsewhere), server did not reject. |
| **GET `/api/accounting/firm/clients`** | Builds list from `firm_client_engagements.client_business_id` and then `businesses`; returns `business_id` from engagement. **No mix-up** here; IDs are from engagements (which should be business ids). |
| **POST `/api/firm/accounting-clients`** | Creates a **new** business, then creates engagement with `client_business_id: business.id`. Does not take `business_id` from client. **No mix-up** in this path. |
| **`ClientSelector`** | Uses `/api/accounting/firm/clients`; displays and sets `business_id` from API. **No mix-up**; source is engagement’s `client_business_id`. |
| **`/api/accounting/firm/engagements/effective`** | Uses authority engine; returns business ids from engagements. **No confusion** at read path; bad data would only appear if engagements were created with wrong `client_business_id` (now prevented on create). |

### Exact files/lines (mix-up risk and fix)

- **`app/api/accounting/firm/engagements/route.ts`**  
  - **Lines ~35–41:** Body parsed as `firm_id`, `business_id`; no check that `business_id !== firm_id` or that `business_id` is not an accounting firm id.  
  - **Fix (implemented):** After required-field checks, reject if `business_id === firm_id` with 400; then reject if `business_id` exists in `accounting_firms` with 400. This prevents firm id from ever being stored as `client_business_id`.

No other code paths were found that **create** engagements with a user-supplied `business_id`; the only creation paths are:
1. POST `/api/accounting/firm/engagements` (body `firm_id` + `business_id`) — **fixed**.
2. POST `/api/firm/accounting-clients` (creates business then engagement; no `business_id` input) — **already correct**.

---

## 2) Minimal changes (no RLS / no migrations)

1. **POST `/api/accounting/firm/engagements`** (`app/api/accounting/firm/engagements/route.ts`):
   - Reject with 400 if `business_id === firm_id` (message: client_business_id cannot equal accounting_firm_id).
   - Reject with 400 if `business_id` is present in `accounting_firms.id` (message: client_business_id must be a business id, not an accounting firm id).

No changes to RLS, migrations, UI, or effective/context-check routes are required for this fix.

---

## 3) Verification checklist

### Create pending engagement (correct IDs)

- Use **accounting_firm_id** = `986a983e-...`, **client_business_id** = `8aa623a8-...` (Ledger).
- Example (after fix):

```bash
# As firm user (cacc11ac-...), create engagement
curl -X POST .../api/accounting/firm/engagements \
  -H "Content-Type: application/json" \
  -d '{
    "firm_id": "986a983e-...",
    "business_id": "8aa623a8-...",
    "access_level": "approve",
    "effective_from": "2025-02-11"
  }'
```

- Expect: 200, engagement with `status: "pending"`, no `accepted_at` set.
- Sanity check: sending `business_id: "986a983e-..."` (firm id) must return **400** with the new validation message.

### Acceptance (service PATCH only)

- Owner accepts **only** via service PATCH (e.g. `PATCH /api/service/engagements/[id]`) setting `status: 'accepted'` and `accepted_at` / `accepted_by`.

### Verify accountant access after acceptance

- Call: `GET /api/debug/accounting-authority?business_id=8aa623a8-...` (Ledger’s business id).
- Expected: `allowed: true`, `reason: "OK"`.
- Call with firm id: `GET /api/debug/accounting-authority?business_id=986a983e-...` → expected `allowed: false`, `reason: "NO_ENGAGEMENT"` (and no use of firm id as client).

---

## 4) Summary

- **Mix-up:** Request body or caller sent firm id as `business_id` when creating an engagement; server did not reject it, leading to FK failure and/or wrong authority checks.
- **Fix:** Validate in POST engagements that `business_id !== firm_id` and that `business_id` is not in `accounting_firms`. No other code paths needed changing.
- **Verification:** Create engagement with correct ids → accept via service PATCH → confirm `GET /api/debug/accounting-authority?business_id=8aa623a8-...` returns `allowed: true`, and that using firm id as `business_id` in create returns 400.
