# FINZA VERIFICATION — SERVICE CONTEXT CONSISTENCY

**MODE:** Read-only verification. No code changes. No patches.

Verification is by **code trace**: same (supabase, userId) and single canonical resolver imply same businessId everywhere in Service.

---

## SECTION 1 — Runtime Context Proof

**Scenario:** Logged-in user with multiple owned businesses; pending firm_client_engagement on business B. Assume B is the most recently created owned business (created_at DESC → B).

For the same request/session, (supabase, userId) is fixed. All of the following resolve business as follows:

| Route / API | Resolver path | businessId | business.name | Identity |
|-------------|---------------|------------|---------------|----------|
| /dashboard | getCurrentBusiness(supabase, user.id) | B | businessData.name | Same |
| /service/invitations | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | (API does not fetch name; id = B) | Same |
| /service/ledger | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | (page uses ctx.businessId for API) | Same |
| /service/reports/profit-and-loss | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |
| /service/reports/trial-balance | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |
| /service/reports/balance-sheet | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |
| /service/health | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |
| /service/expenses/activity | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |
| GET /api/service/invitations | resolveServiceBusinessContext → getCurrentBusiness(supabase, user.id) | B | — | Same |

**Resolver path summary:**

- **Dashboard:** app/dashboard/page.tsx line 103 → getCurrentBusiness(supabase, user.id). Returns full business (id, name, …).
- **All /service/* pages and /api/service/invitations:** resolveServiceBusinessContext(supabase, user.id) → lib/serviceBusinessContext.ts lines 23–31 → getCurrentBusiness(supabase, userId); then return business.id or NO_CONTEXT.

**Conclusion:** For fixed userId and supabase, getCurrentBusiness is deterministic (owner: ORDER BY created_at DESC LIMIT 1; member: first non-archived by created_at). So every row above resolves to the same businessId (B when B is the chosen business). business.name is the same wherever the full business is loaded (dashboard); service pages/API use businessId only, which matches.

**Identity match:** YES — one canonical source (getCurrentBusiness), same inputs (supabase, userId) → same businessId and thus same logical business (and same name when present).

---

## SECTION 2 — Engagement Visibility Re-test

**Same user (owner of A and B; B = most recent; pending engagement on B):**

- **Accounting firm client list:** Lists clients of the firm; engagement has client_business_id = B. Firm sees B in client list. **Expected:** engagement appears. **Confirmed by:** firm client list queries firm_client_engagements / engagements by firm; RLS (e.g. migration 281) allows firm to see engagements; client B is included.

- **Service → Accountant Requests:** Invitations API uses resolveServiceBusinessContext → getCurrentBusiness → B. Query: firm_client_engagements where client_business_id = B. **Expected:** pending engagement for B appears. **Confirmed by:** API line 53 .eq("client_business_id", businessId) with businessId = B.

- **client_business_id === resolved service businessId:** Resolved service businessId = B (from getCurrentBusiness). Engagement’s client_business_id = B. **Match:** YES.

---

## SECTION 3 — Negative Test (NO_CONTEXT)

**Firm-only user (no owned business, no business_users membership):**

- getCurrentBusiness(supabase, userId): owner path returns nothing; business_users path returns nothing → null.
- resolveServiceBusinessContext: getCurrentBusiness returns null → line 24–26 → return { error: "NO_CONTEXT" }.
- Invitations API (line 38–42): ctx has "error" in ctx → returns 200 with { businessId: null, pending: [], active: [] }. **Empty.** No firm data in response.

**Firm user acting on unclaimed client (business with owner_id null):**

- If the firm user is not in business_users for that client (typical: firm staff are in accounting_firm_users, not client’s business_users), getCurrentBusiness returns null or another business → resolveServiceBusinessContext → NO_CONTEXT or other business.
- If getCurrentBusiness were to return the unclaimed business (e.g. hypothetical membership), serviceBusinessContext.ts lines 27–28: if business.owner_id == null → return { error: "NO_CONTEXT" }. So unclaimed business is never returned as service context.
- **No leakage:** Service invitations and service pages never receive a businessId for unclaimed clients; API returns empty when NO_CONTEXT.

---

## SECTION 4 — Accounting Regression Check

| Item | Verification | PASS/FAIL |
|------|--------------|-----------|
| resolveAccountingBusinessContext priority | lib/accountingBusinessContext.ts unchanged: 1) URL business_id, 2) getActiveClientBusinessId(), 3) getCurrentBusiness(supabase, userId). | **PASS** |
| URL business_id override | Line 29–31: urlBusinessId checked first; when present, returned as source "client". No change in this file. | **PASS** |
| Session active client | Line 33–36: getActiveClientBusinessId() used second. firmClientSession.ts not modified. | **PASS** |
| Firm client switching | Firm client list and setActiveClientBusinessId set session/cookie; accounting pages use resolveAccountingBusinessContext which reads URL then session. No change to firm flows or accountingBusinessContext. | **PASS** |

---

## SECTION 5 — Final Confirmation

**Is there now exactly ONE definition of “current business” in Service?**

**YES.** In Service workspace, “current business” is uniquely defined as the result of getCurrentBusiness(supabase, userId), exposed to callers either directly (e.g. dashboard) or via resolveServiceBusinessContext (all /service/* and GET /api/service/invitations). resolveServiceBusinessContext is a thin wrapper (same result + claimed-only guard). No other resolver is used for Service context.

**Can Service and Accounting ever disagree again without explicit selection?**

**YES**, but only when the user has made an **explicit** selection in Accounting. Accounting uses URL business_id first, then session active client, then getCurrentBusiness. So:

- **Without explicit selection in Accounting:** Fallback is getCurrentBusiness(supabase, userId), which is the same as Service. They agree.
- **With explicit selection in Accounting:** User can choose a different client (e.g. from firm client list → sets session/URL to client A). Then Accounting shows client A; Service still shows “current business” from getCurrentBusiness (e.g. owned business B). That is by design: Accounting is multi-client selectable; Service is single deterministic business. The “disagreement” is due to explicit client selection in Accounting, not drift between two definitions of “current business” within Service.

Within Service alone, there is no remaining source of disagreement: one definition, one resolver path.
