# Canonical Accounting Authority Engine — Verification Checklist

After deploying the authority engine (`lib/accountingAuthorityEngine.ts`) and routing firm access through it, verify the following. No migrations, no RLS changes, no UI changes were made; behavior should match prior semantics with a single source of truth.

---

## 1. Firm user with accepted + effective engagement

**Setup:** Firm user belongs to a firm; there exists a `firm_client_engagements` row for (firm_id, client_business_id) with `status IN ('accepted','active')` and today within `effective_from` / `effective_to` (or `effective_to` null).

**Expected:** User can open accounting pages (ledger, reports, periods, etc.) for that business when that business is selected (URL `business_id` or session client).

**How to verify:** Log in as firm user, select the client (or land with single effective client auto-selected). Navigate to e.g. `/accounting/ledger`, `/accounting/reports/balance-sheet`. Pages load; no 403. `[AUTH_ENGINE]` log line appears with `allowed: true`, `reason: "OK"` when authority is checked.

---

## 2. Firm user with pending only

**Setup:** Only engagement(s) for the firm–client pair have `status = 'pending'` (not yet accepted).

**Expected:** User cannot access that client’s accounting data. Engine returns `allowed: false`, `reason: "NOT_ACCEPTED"`. Client should not appear in effective client list; if user had previously selected that client (e.g. stale session), context-check should treat as no valid client and redirect to client picker or auto-select another if only one effective.

**How to verify:** As firm user, ensure no accepted/active engagement for a given business. That business should not appear in ClientSelector (effective list). If URL or cookie still has that business_id, context-check should return `hasClient: false` and `redirectTo` to client picker.

---

## 3. Firm user with accepted but effective_from in future

**Setup:** Engagement has `status = 'accepted'` (or `'active'`) but `effective_from` is a future date (e.g. next month).

**Expected:** User cannot access until that date. Engine returns `allowed: false`, `reason: "NOT_EFFECTIVE"`. Client should not appear in effective list for today.

**How to verify:** Set one engagement’s `effective_from` to a future date (DB or fixture). As firm user, that client should not appear in effective list. Direct request with that business_id should get 403 or context-check should return no valid client.

---

## 4. Firm user with multiple clients

**Setup:** Firm user has multiple effective engagements (accepted/active and within effective dates) for different client businesses.

**Expected:** Client selector shows only those clients that pass the engine (same set as `getEffectiveBusinessIdsForFirmUser`). No duplicate entries; no clients that are pending or outside effective window.

**How to verify:** Compare ClientSelector dropdown (fed by GET `/api/accounting/firm/engagements/effective`) with list of businesses for which `getAccountingAuthority(..., businessId)` returns `allowed: true`. They should match.

---

## 5. Owner still accepts invitations in service mode

**Setup:** Business owner in service workspace; pending engagement exists for their business.

**Expected:** Invitation list shows pending; owner can accept via Service PATCH `/api/service/engagements/[id]` with `action: "accept"`. No change to this flow (accept is owner-only, does not use the firm authority engine).

**How to verify:** As owner, open `/service/invitations` or equivalent; accept a pending engagement. Status moves to accepted; no regression.

---

## 6. No new recursion errors

**Setup:** Firm user with effective engagement; open accounting pages that trigger RLS and API authority checks.

**Expected:** No “infinite recursion” or stack overflow. Businesses RLS still uses `has_firm_engagement_with_business` (SECURITY DEFINER); the engine does not query `businesses`, so no new RLS recursion from the engine.

**How to verify:** Use accounting workspace as firm user; open ledger, reports, periods. No recursion errors in server logs. RLS policies unchanged (no migrations).

---

## Summary

| # | Scenario | Pass criteria |
|---|----------|----------------|
| 1 | Accepted + effective engagement | Can open accounting pages for that client |
| 2 | Pending only | Cannot access; NOT_ACCEPTED; client not in effective list |
| 3 | Accepted but effective_from future | Cannot access until date; NOT_EFFECTIVE |
| 4 | Multiple clients | Client list = engine-effective only |
| 5 | Owner accept | Invitations accept still works in service |
| 6 | Recursion | No new RLS/recursion errors |
