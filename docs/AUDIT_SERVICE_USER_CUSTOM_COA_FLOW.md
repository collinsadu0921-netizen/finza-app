# Audit: Service User Custom COA Flow (Read-Only Trace)

**Mode: READ-ONLY. No fixes. No refactors.**

Full trace of how a **service user-created account** flows into the ledger.

---

## 1. COA Creation Flow

### Where does `/api/accounting/coa` POST create a new account?

**It does not.** `/api/accounting/coa` has no POST handler.

- **File:** `finza-web/app/api/accounting/coa/route.ts`  
- **Content:** Only `export async function GET(request: NextRequest)` (lines 20–81). No POST export.

### Where is a new account created?

**File:** `finza-web/app/api/accounts/create/route.ts`

- **Method:** POST only (line 5: `export async function POST(request: NextRequest)`).
- **Auth:** `getCurrentBusiness(supabase, user.id)` (lines 16–19). No `business_id` in body; business is resolved from current user (owner or first business_users row).
- **Required body fields:** `name`, `code`, `type` (lines 23–28). `description` optional.
- **Type validation (lines 31–35):**
```typescript
if (!["asset", "liability", "equity", "income", "expense"].includes(type)) {
  return NextResponse.json(
    { error: "Invalid account type" },
    { status: 400 }
  )
}
```
- **Uniqueness:** Code must be unique per business, non-deleted (lines 38–51): `.eq("business_id", business.id).eq("code", code).is("deleted_at", null)`.
- **Insert (lines 54–65):**
```typescript
const { data: account, error } = await supabase
  .from("accounts")
  .insert({
    business_id: business.id,
    name: name.trim(),
    code: code.trim(),
    type,
    description: description?.trim() || null,
    is_system: false,
  })
  .select()
  .single()
```
- **`is_system`:** Set to `false` (line 62). No `sub_type` in insert (custom accounts get `sub_type` NULL).

### Table inserted into

- **Table:** `accounts`
- **File:** `finza-web/supabase/migrations/043_accounting_core.sql`  
- **Definition (lines 7–18):**
```sql
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(business_id, code)
);
```
- **Sub_type:** Added in `finza-web/supabase/migrations/295_accounts_sub_type.sql` (line 12: `ADD COLUMN IF NOT EXISTS sub_type TEXT`). Not set by `/api/accounts/create`.

### RLS policies affecting insert on `accounts`

- **File:** `finza-web/supabase/migrations/043_accounting_core.sql`  
- **INSERT policy (lines 1141–1150):**
```sql
CREATE POLICY "Users can insert accounts for their business"
  ON accounts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounts.business_id
        AND businesses.owner_id = auth.uid()
    )
    AND is_system = FALSE -- Cannot insert system accounts
  );
```
- **Effect:** Only the business **owner** can insert; `is_system` must be false. No separate service vs firm distinction in this policy; restriction is owner-only.

### Restrictions for service vs firm user

- **API:** No branch on “service” vs “firm”. Creation uses `getCurrentBusiness()`; service owner gets their business, so creation succeeds for owner. Firm users (accountants) creating for a client would use a different flow (no create-account API that accepts `business_id`).
- **RLS:** Insert allowed only when `businesses.owner_id = auth.uid()`. So only the business owner can insert accounts (service owner = yes; firm user inserting for client = no, unless acting as that business’s user in another way).

---

## 2. How Service Screens Load COA

### LedgerScreen

- **File:** `finza-web/components/accounting/screens/LedgerScreen.tsx`
- **Fetch (lines 101–111):**
```typescript
const response = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId)}`)
if (response.ok) {
  const { accounts: data } = await response.json()
  setAccounts(data || [])
}
```
- **COA source:** GET `/api/accounting/coa?business_id=...`. No filter by `is_system` or `account_type` in the screen; uses full list for filter dropdown.
- **Allows selecting newly created accounts:** Yes. All accounts returned by COA (including custom) are in `accounts` and can be used for filtering.

### ContributionScreen (service contribution page)

- **File:** `finza-web/app/service/accounting/contribution/page.tsx`
- **Fetch (lines 74–77):**
```typescript
const res = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId)}`)
const data = await res.json()
const accounts: Account[] = data.accounts || []
```
- **Mapping (lines 79–88):**
  - `bankCashAccounts = accounts.filter(isBankOrCash)`  
  - `isBankOrCash`: `acc.type === "asset"` and `acc.sub_type` in `['bank','cash']` (lines 22–28).  
  - `equityAccounts = accounts.filter((a) => a.type === "equity")`.
- **Filter:** Does **not** filter out `is_system === true`. Does filter by **type** (asset for bank/cash, equity for equity) and by **sub_type** for bank/cash.
- **Custom accounts:** A newly created **asset** account has `sub_type` NULL (not set by create API). So it does **not** appear in “Deposit to” (bank/cash dropdown). Custom **equity** accounts appear in the equity dropdown (no sub_type requirement). So newly created accounts are only partially usable: equity yes, bank/cash no unless they have sub_type.

### AdjustmentScreen (service adjustment page)

- **File:** `finza-web/app/service/accounting/adjustment/page.tsx`
- **Fetch (lines 69–74):**
```typescript
const res = await fetch(`/api/accounting/coa?business_id=${encodeURIComponent(businessId)}`)
const data = await res.json()
setAccounts(data.accounts || [])
```
- **Filter:** No filter by `is_system` or `account_type`. All COA accounts are shown in line account pickers.
- **Allows selecting newly created accounts:** Yes.

### Expense/invoice screens using accounts

- **Assets create page:** `finza-web/app/assets/create/page.tsx` line 70: `fetch("/api/accounts/list")` — uses **list** API, not COA. List returns same business’s accounts (getCurrentBusiness); custom accounts are included.
- **Accounting adjustments page:** `finza-web/app/accounting/adjustments/page.tsx` line 139: `fetch(\`/api/accounting/coa?business_id=${businessId}\`)` — same as COA; custom accounts included.
- **Manual journal drafts (new/edit):** `finza-web/app/accounting/journals/drafts/new/page.tsx` line 91, `finza-web/app/accounting/journals/drafts/[id]/edit/page.tsx` line 216: fetch `/api/accounting/coa?business_id=...` — custom accounts included.

---

## 3. Journal Posting Path (Service User Selects Custom Account)

### Where `account_id` is passed

- **Contribution:** POST `/api/accounting/journals/drafts` with body `lines: [{ account_id: depositToId, debit, credit }, { account_id: equityId, debit, credit }]` (contribution page lines 151–155).
- **Adjustment:** POST `/api/accounting/journals/drafts` with body `lines: lines.map((l) => ({ account_id: l.account_id, debit, credit }))` (adjustment page lines 168–172).

### API endpoint that receives it

- **File:** `finza-web/app/api/accounting/journals/drafts/route.ts`  
- **Handler:** POST (create draft). Lines formatted (lines 495–501): `formattedLines = lines.map((line) => ({ account_id: line.account_id, debit, credit, memo }))`. Stored in `manual_journal_drafts.lines` (JSONB).

### Where journal_entry + journal_entry_lines are created

- **Owner-mode:** After inserting the draft (status `approved`), the route immediately calls (lines 551–557):
```typescript
const { data: journalEntryId, error: postError } = await supabase.rpc(
  "post_manual_journal_draft_to_ledger",
  { p_draft_id: draftId, p_posted_by: user.id }
)
```
- **DB function:** `post_manual_journal_draft_to_ledger(p_draft_id, p_posted_by)`.

### DB function that posts to ledger

- **File:** `finza-web/supabase/migrations/300_manual_draft_single_insert_lines.sql`
- **Function:** `post_manual_journal_draft_to_ledger(p_draft_id UUID, p_posted_by UUID)` (lines 10–235).
- **journal_entries insert (lines 174–205):** business_id, date, description, reference_type `'manual'`, reference_id = draft id, source_type `'manual_draft'`, source_id/source_draft_id, input_hash, period_id, created_by, posted_by, posting_source `'system'`.
- **journal_entry_lines insert (lines 207–220):**
```sql
INSERT INTO journal_entry_lines (
  journal_entry_id,
  account_id,
  debit,
  credit,
  description
)
SELECT
  v_journal_entry_id,
  (jl->>'account_id')::UUID,
  COALESCE((jl->>'debit')::NUMERIC, 0),
  COALESCE((jl->>'credit')::NUMERIC, 0),
  jl->>'memo'
FROM jsonb_array_elements(draft_record.lines) AS jl;
```
- **account_id:** Taken from each element of `draft_record.lines` as `(jl->>'account_id')::UUID`. No explicit “account exists” or “account belongs to business” check in the function; enforcement is by FK and RLS.

### Full path summary

1. **UI:** Service contribution or adjustment page sends `account_id` in `lines` to POST `/api/accounting/journals/drafts`.
2. **API:** `finza-web/app/api/accounting/journals/drafts/route.ts` POST: validates auth (owner-mode: `checkAccountingAuthority` write), inserts `manual_journal_drafts` with `lines` (including account_id), then calls `post_manual_journal_draft_to_ledger`.
3. **RPC:** `post_manual_journal_draft_to_ledger` (migration 300): reads draft, validates period not locked, owner auth (business.owner_id = p_posted_by), idempotency; inserts `journal_entries` then single INSERT into `journal_entry_lines` with account_id from draft lines.
4. **DB:** `journal_entry_lines.account_id` has FK to `accounts(id)` (043_accounting_core.sql line 52: `account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`). Invalid or wrong-business account_id would fail at insert if it violated FK or RLS.

### post_journal_entry / post_journal_entry_draft / post_sale_to_ledger

- **post_journal_entry:** Used by invoice, payment, adjustment (apply_adjusting_journal), reversal, year-end close, etc. Not used by service contribution/adjustment; those use `post_manual_journal_draft_to_ledger`.
- **post_manual_journal_draft_to_ledger:** Used by service contribution and adjustment (and firm manual draft post). Inserts lines from draft JSONB; no call to post_journal_entry.
- **post_sale_to_ledger:** Used by sales flow; calls post_journal_entry internally. Not used when service user selects a custom account in contribution/adjustment.

### Trigger validation (balance)

- **Trigger:** `trigger_enforce_double_entry_balance` on `journal_entry_lines` (AFTER INSERT FOR EACH STATEMENT).  
- **File:** `finza-web/supabase/migrations/188_fix_journal_balance_enforcement.sql` (lines 69–72).  
- **Function:** `enforce_double_entry_balance_statement()` — ensures SUM(debit) = SUM(credit) for the journal entry. No account_type or account-existence check; that is left to FK.

---

## 4. Validation & Constraints

### DB validates account_id exists

- **Yes.** `journal_entry_lines.account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (043_accounting_core.sql lines 50–52). Insert of a non-existent or deleted account id fails at FK.

### DB validates account_type (e.g. cannot post revenue into asset incorrectly)

- **post_journal_entry:** Has revenue-account checks (253_accounting_adoption_boundary.sql: revenue only for invoice issuance or explicit revenue correction). It identifies revenue by account_id = get_account_by_code(p_business_id, '4000') (system revenue), not by generic “income” type. Custom income accounts used in manual draft path are not special-cased there.
- **post_manual_journal_draft_to_ledger:** No check that line account_id is a certain type. Any account_id that exists and belongs to the same business (via journal_entries.business_id and accounts.business_id) can receive debits/credits. No DB-level rule like “revenue account only in invoice flow” in this path.

### Period locking prevents posting

- **post_manual_journal_draft_to_ledger:** Lines 58–68 in 300_manual_draft_single_insert_lines.sql: loads period by draft_record.period_id; if `period_record.status = 'locked'` then `RAISE EXCEPTION 'Cannot post to locked period'`. No check for soft_closed in this function (only locked blocks).

### RLS restricts posting into accounts owned by another business

- **journal_entries:** INSERT policy in 043 (lines 1192–1199): WITH CHECK (business_id such that businesses.owner_id = auth.uid()). So only owner can insert journal_entries for that business. RPC runs as SECURITY DEFINER (300 line 236–237: `SECURITY DEFINER SET search_path = ...`), so RLS is bypassed when the function runs; auth is enforced inside the function (owner: business.owner_id = p_posted_by).
- **journal_entry_lines:** INSERT policy (043 lines 1217–1226): WITH CHECK (journal_entry’s business has businesses.owner_id = auth.uid()). Again, function is definer so RLS bypassed; consistency is business_id from draft = client_business_id.
- **accounts:** SELECT policy (043 lines 1131–1139): USING (businesses.id = accounts.business_id AND businesses.owner_id = auth.uid()). So only owner can read their business’s accounts. Firm/engagement policies added in 278 for journal_entries/journal_entry_lines/periods/trial_balance_snapshots; accounts RLS in 043 remains owner-only for SELECT/INSERT/UPDATE/DELETE.

### FK constraints

- **journal_entry_lines:** `journal_entry_id` → journal_entries(id) ON DELETE CASCADE; `account_id` → accounts(id) ON DELETE RESTRICT (043 lines 50–52).
- **accounts:** `business_id` → businesses(id) ON DELETE CASCADE (043 line 9).

### CHECK constraints

- **accounts:** `type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense'))` (043 line 12).

### Trigger names

- **Double-entry balance:** `trigger_enforce_double_entry_balance` on `journal_entry_lines`, function `enforce_double_entry_balance_statement()` (188).

### RLS policies on accounts

- **043:** "Users can view accounts for their business" (SELECT, owner); "Users can insert accounts for their business" (INSERT, owner, is_system = FALSE); "Users can update non-system accounts for their business" (UPDATE, owner); "Users can delete non-system accounts for their business" (DELETE, owner).

### RLS policies on journal tables

- **journal_entries:** SELECT/INSERT by owner (043); 278 adds "Firm users can view journal entries for engaged clients" (SELECT only).
- **journal_entry_lines:** SELECT/INSERT by owner via journal_entries join (043); 278 adds "Firm users can view journal entry lines for engaged clients" (SELECT only).

---

## 5. Trial Balance & Reports

### Trial balance includes custom account automatically

- **Yes.** `generate_trial_balance` (169_trial_balance_canonicalization.sql lines 86–92) iterates over all accounts for the period’s business:
```sql
FOR account_record IN
  SELECT id, code, name, type
  FROM accounts
  WHERE business_id = period_record.business_id
    AND deleted_at IS NULL
  ORDER BY code
LOOP
```
- No filter by `is_system` or type. Each account gets opening balance from period_opening_balances and period movement from journal_entry_lines; closing balance by type (asset/expense vs liability/equity/income). Custom accounts are included.

### Snapshot includes it

- **Yes.** Snapshot is built by `generate_trial_balance`, which uses the same loop over all accounts. Snapshot data (trial_balance_snapshots.snapshot_data) is populated from that. Marking stale on journal insert is in 247 (invalidate_snapshot_on_journal_entry). Rebuild includes all accounts for the period.

### Account_type excluded from reports

- **P&L:** `get_profit_and_loss_from_trial_balance` (234_fix_trial_balance_account_type_ambiguous.sql) iterates over `get_trial_balance_from_snapshot(p_period_id)` and uses account_type (income/expense) for P&L. So custom income/expense accounts are included.
- **Balance sheet:** `get_balance_sheet_from_trial_balance` uses snapshot and filters by account type (asset, liability, equity). Custom asset/liability/equity are included.
- **Trial balance:** All accounts in snapshot; no type exclusion.

---

## 6. Edge Case Audit

### If a service user creates:

**A revenue account (type = income)**  
- **Journal posting:** Yes. Adjustment/contribution use drafts → `post_manual_journal_draft_to_ledger`; no revenue-only restriction in that path. Selecting this account on a line and posting succeeds.  
- **Trial balance:** Yes. Included in snapshot (all accounts).  
- **Period close:** Imbalance detection uses trial balance (e.g. run_period_close_checks uses get_trial_balance_from_snapshot). Custom income account balances are included; imbalance detection is correct.

**An expense account (type = expense)**  
- **Journal posting:** Yes. Same as above.  
- **Trial balance:** Yes.  
- **Period close:** Yes. Same as above.

**An asset account (type = asset)**  
- **Journal posting:** Yes.  
- **Trial balance:** Yes.  
- **Period close:** Yes.  
- **Contribution “Deposit to” dropdown:** No. Contribution uses `isBankOrCash(acc)` (asset + sub_type in ['bank','cash']). Custom asset has sub_type NULL, so it does not appear in the dropdown unless sub_type is set elsewhere.

**A liability account (type = liability)**  
- **Journal posting:** Yes.  
- **Trial balance:** Yes.  
- **Period close:** Yes.

---

## Output summary

| Section | Key files |
|--------|-----------|
| 1. COA creation | `/api/accounting/coa` GET only. Creation: `app/api/accounts/create/route.ts`. Table: `accounts` (043). RLS: 043 accounts INSERT (owner, is_system = FALSE). |
| 2. Service screens load COA | LedgerScreen, contribution, adjustment: GET `/api/accounting/coa`. Contribution filters bank/cash by type + sub_type; adjustment uses all accounts. |
| 3. Journal posting | POST `/api/accounting/journals/drafts` → `post_manual_journal_draft_to_ledger` (300) → INSERT journal_entries, journal_entry_lines (account_id from draft lines). |
| 4. Validation | account_id: FK to accounts(id). account_type: no check in manual draft path. Period: locked blocks in RPC. RLS: owner on accounts; definer RPC bypasses RLS. |
| 5. Trial balance / reports | generate_trial_balance (169) loops all accounts; snapshot includes custom; P&L/BS filter by type, include custom. |
| 6. Edge cases | Revenue/expense/asset/liability: posting and TB/period close work. Contribution “Deposit to” only shows asset accounts with sub_type bank/cash (custom asset without sub_type excluded). |
