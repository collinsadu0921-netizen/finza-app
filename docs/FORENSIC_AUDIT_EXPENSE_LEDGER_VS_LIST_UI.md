# Forensic Audit: Expense Ledger vs Expense List UI

**Scope:** Service Workspace expense lifecycle — why an expense can post to the ledger but not appear in the expense list UI.  
**Mode:** Read-only. No code changes, fixes, or refactors.

---

## SECTION 1 — Expense Creation Write Path

### Routes that create expenses

| Route | Method | Creates expense row? | Ledger posting |
|-------|--------|----------------------|----------------|
| `POST /api/expenses/create` | POST | Yes | Via DB trigger after INSERT |

**Other paths checked (do not create expense rows):**

- **`apply_adjusting_journal`** — Creates journal entries with `reference_type = 'adjustment'`. Does not insert into `expenses`. Not an expense creation path.
- **`post_journal_entry`** — Called by `post_expense_to_ledger` and by adjustment/carry-forward flows. Only creates ledger rows; no expense insert.
- **`/expenses/create`** — UI page only; it calls `POST /api/expenses/create`.

### Order of operations (create path)

1. **API:** `POST /api/expenses/create` receives body with `business_id`, `supplier`, `category_id`, amount, tax fields, `date`, `notes`, `receipt_path`.
2. **API:** Validates user via `getUserRole(supabase, user.id, business_id)` and business not archived.
3. **API:** Single operation: `supabase.from("expenses").insert({...}).select(...).single()`.
4. **DB:** Row inserted into `expenses`.
5. **DB:** Trigger `trigger_auto_post_expense` fires **AFTER INSERT** on `expenses` (migration 043).
6. **DB:** Trigger calls `post_expense_to_ledger(NEW.id)` only when `NEW.deleted_at IS NULL` and no existing JE for this expense.
7. **DB:** `post_expense_to_ledger` reads the new row, then calls `post_journal_entry(..., 'expense', p_expense_id, ...)`.

**Conclusion:** Ledger posting happens **after** the insert, in the same transaction, via trigger. The API does **not** call any ledger RPC directly.

### Code paths that create ledger entries without expense records

- **None** for expense-type ledger entries. Every `reference_type = 'expense'` JE is created by `post_expense_to_ledger`, which is only invoked from the `AFTER INSERT` trigger on `expenses` and receives a valid `expense_id`.
- Adjusting journals create JEs with `reference_type = 'adjustment'`, not expense records.

---

## SECTION 2 — Expense List Read Path

### UI and API

- **Service workspace expense list:** `app/expenses/page.tsx` (route: `/expenses`). Sidebar: "Expenses" → `/expenses`.
- **Data source:** Page calls `GET /api/expenses/list?business_id=...&category_id=...&start_date=...&end_date=...`.
- **API handler:** `app/api/expenses/list/route.ts`.

### Exact list query (API)

```ts
let query = supabase
  .from("expenses")
  .select(`*, expense_categories ( id, name )`)
  .is("deleted_at", null)
  .order("date", { ascending: false })

if (businessId)   query = query.eq("business_id", businessId)
if (categoryId)   query = query.eq("category_id", categoryId)
if (startDate)    query = query.gte("date", startDate)
if (endDate)      query = query.lte("date", endDate)

const { data: expenses, error } = await query
```

- **Table:** `expenses` only (no ledger table, no bills join).
- **Filters:**  
  - `deleted_at IS NULL` (always).  
  - `business_id` (only when `business_id` query param is present).  
  - Optional: `category_id`, `start_date`, `end_date`.
- **Auth:** Comment states "AUTH DISABLED FOR DEVELOPMENT". The code that would require a logged-in user and set `business_id` from `getCurrentBusiness` is commented out; the API only applies `business_id` when the client sends it.

### Supabase client used by list API

- **Import:** `import { supabase } from "@/lib/supabaseClient"`.
- **Definition:** `supabaseClient` uses `createBrowserClient(SUPABASE_URL, ANON_KEY)` (no request or cookies).
- **Context:** The list handler runs in a **Next.js API route (server)**. The same singleton client is used. That client is **not** created with the incoming request or cookies, so it has **no session** when the route runs on the server.
- **RLS:** Table `expenses` has RLS enabled (migration 230). Policy "business members can read expenses" allows SELECT only when:
  `EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = expenses.business_id AND bu.user_id = auth.uid())`.
- **Effect:** With the client used in the list route, `auth.uid()` is **null** on the server. The RLS condition is false for every row, so **no expenses are returned** regardless of `business_id` filter.

### Filters that can hide valid expenses

| Filter | Applied | Risk |
|--------|--------|------|
| `deleted_at IS NULL` | Always | Correct; soft-deleted excluded. |
| `business_id` | Only when query param set | UI does send `business_id`; if missing, results would be wrong. |
| RLS "business members can read" | Always (when RLS runs) | **Critical:** With no session, `auth.uid()` is null → no rows pass → list is empty. |
| `category_id`, `start_date`, `end_date` | When provided | Normal filters; can narrow but not cause “posted but not visible” by themselves. |

**Conclusion:** The list reads **only** from `expenses` (not from ledger). The dominant risk for “expense in ledger but not in list” is **RLS with an unauthenticated client**: the list API uses a Supabase client that has no session on the server, so RLS hides all expense rows.

---

## SECTION 3 — Ledger → Expense Referential Integrity

### `post_expense_to_ledger` (migration 229)

- **Signature:** `post_expense_to_ledger(p_expense_id UUID, p_entry_type TEXT DEFAULT NULL, p_backfill_reason TEXT DEFAULT NULL, p_backfill_actor TEXT DEFAULT NULL)`.
- **Invocation:** Only from trigger `trigger_post_expense()` with `NEW.id` (so always a valid expense row id from the same INSERT).
- **Idempotency:** Checks for existing JE with `reference_type = 'expense' AND reference_id = p_expense_id`; if found, returns existing id (no second post).
- **Read:** `SELECT ... FROM expenses ex WHERE ex.id = p_expense_id`. If not found, raises `'Expense not found: %', p_expense_id`.
- **Write:** Calls `post_journal_entry(business_id_val, expense_row.date, v_description, **'expense'**, **p_expense_id**, journal_lines, ...)`.

**Reference integrity:**

- `reference_type = 'expense'` and `reference_id = p_expense_id` are **always** set by this function; no branch uses `'adjustment'`, `'manual'`, or NULL for expense posts from this path.
- No fallback in `post_expense_to_ledger` that would create a JE with a different reference_type for normal expense creation.

**Alternate posting logic:** Backfill path uses same function with `p_entry_type = 'backfill'`; still uses `'expense'` and `p_expense_id` in `post_journal_entry`.

---

## SECTION 4 — Trigger and Transaction Risks

### Mechanism

- **Trigger:** `trigger_auto_post_expense` (AFTER INSERT ON expenses). Function `trigger_post_expense()` runs in the **same transaction** as the INSERT.
- **Flow:** INSERT → trigger → `post_expense_to_ledger(NEW.id)` → `post_journal_entry(...)`.
- **Transaction:** All in one transaction. If `post_expense_to_ledger` or `post_journal_entry` raises, the INSERT is rolled back. If INSERT fails, trigger does not run.

### Answers

1. **If expense insert fails, can ledger still post?** No. The trigger runs only after a successful INSERT.
2. **If ledger post fails, does expense insert roll back?** Yes. Trigger runs in the same transaction; exception rolls back the whole transaction.
3. **Are errors swallowed in the API?** No. The API returns 500/400 and does not catch and ignore trigger/DB errors; the client receives the error.

**Conclusion:** No partial-write risk between expense row and expense JE. The only way to have an expense JE without an expense row would be manual DB operations or a different code path that calls `post_journal_entry` with `reference_type = 'expense'` and some id — no such path was found in the app.

---

## SECTION 5 — Workspace Context Validation

### Resolve functions

- **`resolveServiceBusinessContext` / `resolveAccountingBusinessContext`:** Not used in the expense create or list routes. Create uses `business_id` from request body; list uses `business_id` from query param (from UI’s `getCurrentBusiness(supabase, user.id)`).

### Business ID usage

| Step | Source of business_id | Same business? |
|------|------------------------|----------------|
| Expense create | Request body `business_id` | N/A (single business per request). |
| Ledger posting | Read from `expenses.business_id` in `post_expense_to_ledger` | Same as inserted row. |
| Expense list UI | `getCurrentBusiness(supabase, user.id)` then query param `business_id` | Same business intended. |
| Expense list API | Query param `business_id` only (optional filter) | Same business when UI sends it. |

**Mismatch risk:** The list API does not derive `business_id` from the authenticated user (auth is commented out). It relies entirely on the client sending `business_id`. So:

- If the client sends the correct `business_id`, the **filter** is correct, but **RLS still blocks** all rows when the API’s Supabase client has no session.
- No evidence of business_id mix-up between create and list for the same user; the main failure is RLS hiding all rows in the list.

---

## SECTION 6 — Status and Visibility Rules

### Expense table

- **Schema (051, 229):** No `status` column. Columns include: `id`, `business_id`, `supplier`, `category_id`, `amount`, `nhil`, `getfund`, `covid`, `vat`, `total`, `date`, `notes`, `receipt_path`, `created_at`, `updated_at`, `deleted_at`.
- **Visibility:** Effectively “visible” when `deleted_at IS NULL`. No draft/posted/approved status on the table; “posted” is implied by existence of a JE with `reference_type = 'expense'` and `reference_id = expense.id`.

### List query

- **Status filter:** None (no status column).
- **Visibility:** `.is("deleted_at", null)` and (when applied) `business_id`, plus RLS.

**Conclusion:** No status-based filter that would hide valid expenses. The only document-level visibility rule is `deleted_at IS NULL`. Governance (233) blocks UPDATE/DELETE once a JE exists and blocks INSERT/UPDATE/DELETE when the period is closed/locked; it does not change how the list query selects rows.

---

## SECTION 7 — Expected vs Actual Behaviour Matrix

| Stage | Expected behaviour | Actual implementation | Risk |
|--------|--------------------|------------------------|------|
| **Expense create** | Insert into `expenses` then ledger posts in same transaction. | INSERT via create route; trigger calls `post_expense_to_ledger(NEW.id)`; same transaction. | None. |
| **Ledger post** | Always `reference_type = 'expense'`, `reference_id = expense_id`. | `post_journal_entry(..., 'expense', p_expense_id, ...)` only. | None. |
| **Expense read UI** | List shows all non-deleted expenses for the current business. | UI calls `/api/expenses/list?business_id=...`. API uses `supabase` from `supabaseClient` (browser client). On the server this client has **no session** → RLS sees `auth.uid() = null` → **no rows** returned. | **Critical:** List is empty despite data existing. |
| **Status handling** | No status column; visibility by `deleted_at` only. | Implemented as such. | None. |
| **Business context** | Create and list use same business. | Create: body `business_id`. List: query param from UI. API does not enforce auth or set business from user. | Medium: list relies on client sending correct `business_id`; main failure is RLS, not wrong business. |

---

## SECTION 8 — Final Verdict

### 1. Can an expense be posted to the ledger without an expense record?

**No**, under normal application paths. Every expense JE is created by `post_expense_to_ledger`, which is only called from the AFTER INSERT trigger on `expenses` with `NEW.id`. So for every `reference_type = 'expense'` JE there must have been an expense row at the time of posting. The only way to have a JE without a row would be manual DB edits or deleting the expense row after post (governance trigger blocks DELETE once a JE exists).

### 2. Can valid expense records be hidden by UI filters?

**Yes.** Valid expense rows are hidden because:

- The **list API** uses `supabase` from `@/lib/supabaseClient` (browser client). In the API route (server), this client has **no session** (`auth.uid()` is null).
- RLS on `expenses` allows SELECT only for “business members” (`business_users` + `auth.uid()`). With null `auth.uid()`, the policy allows **no rows**.
- Result: the list returns an empty array even when `expenses` contains rows and the UI sends the correct `business_id`.

So the **effective** “filter” that hides valid expenses is **RLS with an unauthenticated Supabase client** in the list API.

### 3. Data integrity bug or UI query bug?

**UI/API bug (read path), not a data integrity bug.** Data integrity is consistent: expense row exists and is posted to the ledger in one transaction. The failure is in the **read path**: the list API uses a client that does not carry the user’s session on the server, so RLS incorrectly hides all rows.

### 4. Severity

**Critical.** Users see an empty expense list even though expenses exist and are correctly posted to the ledger. This undermines trust and makes it appear that data is missing or that posting failed.

---

**End of audit.**
