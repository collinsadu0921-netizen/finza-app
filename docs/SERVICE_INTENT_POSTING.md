# Service Intent Posting

Service users cannot choose debit/credit; posting is engine-controlled via **intents**.

---

## Files changed / added

| File | Change |
|------|--------|
| `lib/service/accounting/intentTypes.ts` | **New.** ServiceIntent types, INTENT_ACCOUNT_RULES, validateServiceIntent, accountFitsEligibility. |
| `app/api/service/accounting/post-intent/route.ts` | **New.** POST handler: auth, validate intent + accounts, call post_service_intent_to_ledger, return journal_entry_id. |
| `supabase/migrations/304_post_service_intent_to_ledger.sql` | **New.** Allow source_type `service_intent` on journal_entries; add post_service_intent_to_ledger(p_business_id, p_user_id, p_entry_date, p_intent jsonb). |
| `app/service/accounting/contribution/page.tsx` | **Changed.** Post via POST /api/service/accounting/post-intent with OWNER_CONTRIBUTION intent (no drafts). Navigate to /service/ledger?highlight=journal_entry_id. |
| `app/service/accounting/adjustment/page.tsx` | **Replaced.** Removed free-form lines and debit/credit inputs. Now “Owner Withdrawal” only: amount, from (bank/cash), equity account, date, description. Posts via post-intent with OWNER_WITHDRAWAL. |
| `app/service/accounting/page.tsx` | **Changed.** Quick action label/copy: “Record Adjustment” → “Owner Withdrawal”. |

**Unchanged (by design):** Accounting workspace routes and screens; firm workflow; `/api/accounting/journals/drafts`; `post_manual_journal_draft_to_ledger`.

---

## TypeScript types and endpoint contract

### ServiceIntent (discriminated by intent_type)

```ts
// intentTypes.ts
export const SERVICE_INTENT_TYPES = ["OWNER_CONTRIBUTION", "OWNER_WITHDRAWAL"] as const
export type ServiceIntentType = (typeof SERVICE_INTENT_TYPES)[number]

export interface ServiceIntentBase {
  intent_type: ServiceIntentType
  entry_date: string   // YYYY-MM-DD
  description?: string
}

export interface OwnerContributionIntent extends ServiceIntentBase {
  intent_type: "OWNER_CONTRIBUTION"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

export interface OwnerWithdrawalIntent extends ServiceIntentBase {
  intent_type: "OWNER_WITHDRAWAL"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

export type ServiceIntent = OwnerContributionIntent | OwnerWithdrawalIntent
```

### Account eligibility (per intent field)

- **bank_or_cash_account_id:** `type === "asset"` and `sub_type` in `['bank','cash']`.
- **equity_account_id:** `type === "equity"`.

Validation: `validateServiceIntent(intent, accounts)` returns `string | null` (error message or null).

### POST /api/service/accounting/post-intent

- **Body:** `{ business_id: string, intent: ServiceIntent }`
- **Auth:** `checkAccountingAuthority(supabase, user.id, business_id, "write")`. Service owner (or employee with write) only; firm path not used for this endpoint.
- **Validation:** Fetch accounts for `business_id`; `validateServiceIntent(intent, accounts)`.
- **Side effect:** `supabase.rpc("post_service_intent_to_ledger", { p_business_id, p_user_id, p_entry_date: intent.entry_date, p_intent: intent })`.
- **Response 200:** `{ success: true, journal_entry_id: string }`
- **Errors:** 400 (validation, locked period), 403 (unauthorized), 500 (RPC/other).

---

## SQL function: post_service_intent_to_ledger

**Signature:** `post_service_intent_to_ledger(p_business_id UUID, p_user_id UUID, p_entry_date DATE, p_intent JSONB) RETURNS UUID`

**Behaviour:**

1. **Auth:** Ensure `businesses.owner_id = p_user_id` (owner-only).
2. **Period:** Resolve period for `(p_business_id, p_entry_date)`. If not found or status = `locked`, raise.
3. **Parse intent:** `intent_type`, `amount`, `bank_or_cash_account_id`, `equity_account_id`, `description` from `p_intent`.
4. **Insert journal_entries:** `reference_type = 'manual'`, `source_type = 'service_intent'`, `posting_source = 'system'`, `period_id`, `date = p_entry_date`, etc.
5. **Insert journal_entry_lines in one statement:**
   - **OWNER_CONTRIBUTION:** (DR bank/cash, CR equity) for `amount`.
   - **OWNER_WITHDRAWAL:** (DR equity, CR bank/cash) for `amount`.
6. Return `journal_entry_id`.

Existing trigger `trigger_enforce_double_entry_balance` on `journal_entry_lines` remains; single INSERT keeps the entry balanced.

---

## Test steps

### Service (no firm engagement)

1. **Owner contribution**
   - Log in as **service business owner**.
   - Go to Service → Accounting → Record Owner Contribution.
   - Choose date, amount, deposit-to (bank/cash), equity account; optional description.
   - Confirm & Post. Expect redirect to `/service/ledger?business_id=...&highlight=<journal_entry_id>`.
   - On ledger, confirm one journal entry with two lines: DR bank/cash, CR equity; no manual debit/credit inputs on the form.

2. **Owner withdrawal**
   - Same user → Accounting → Owner Withdrawal.
   - Choose date, amount, from (bank/cash), equity account.
   - Confirm & Post. Expect redirect to ledger with highlight.
   - Confirm one entry: DR equity, CR bank/cash.

3. **Validation**
   - Contribution: try posting with amount 0 or missing account → 400 with message.
   - Use a locked period date → 400 “Cannot post to locked period” (or similar).
   - Call POST post-intent as a user who is **not** the business owner (e.g. another business’s owner) with that business_id → 403.

4. **Accounts**
   - Ensure COA has at least one asset with `sub_type` bank or cash and one equity account. Create custom accounts via Chart of Accounts if needed; use them in contribution/withdrawal and confirm they appear in ledger.

### Firm engagement (unchanged)

- **Accounting workspace:** Manual journal drafts (create/edit/post) still use `/api/accounting/journals/drafts` and `post_manual_journal_draft_to_ledger`. No change.
- **Firm user:** Post-intent is **not** exposed to firm users; they do not use Service contribution/withdrawal screens for client books in the same way. If a firm user calls POST post-intent with a client business_id, they are not the owner → 403 from RPC.

### Edge cases

- **Period missing:** If `entry_date` has no accounting period, RPC raises “No accounting period found”. UI can first call GET `/api/accounting/periods/resolve?business_id=...&from_date=...` to surface a friendly message before posting (contribution/withdrawal currently do not; optional improvement).
- **Double-entry trigger:** Single INSERT for both lines per intent; trigger sees balanced entry.
