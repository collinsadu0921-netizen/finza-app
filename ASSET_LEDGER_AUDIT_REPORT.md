# Asset → Ledger Integration Audit Report

**Date:** 2026-02-12  
**Scope:** Fixed Assets module accounting integrity  
**Ledger:** Canonical source of truth; no schema/contract changes.

---

## 1. Executive Summary

**User-reported issue:** “Assets exist only in Assets page; no ledger visibility; no depreciation posting; no journal linkage.”

**Verdict:** **Partially confirmed.** Asset creation and depreciation did call ledger RPCs, but:
- Ledger errors were **swallowed** (API returned success even when posting failed).
- **No period enforcement** in asset/depreciation RPCs.
- **No duplicate posting guard** for depreciation.
- **No acquisition journal linkage** on `assets` (no `acquisition_journal_entry_id`).

Result: assets could exist without journals (e.g. period closed or missing accounts), and depreciation could fail silently or be posted twice.

**Fixes applied:** Migration 290 (period + idempotency + acquisition link), API changes (fail create if acquisition post fails; fail depreciation API if post fails; rollback on failure).

---

## 2. Asset → Ledger Flow Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ASSET CREATION                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  app/api/assets/create/route.ts                                             │
│       │                                                                     │
│       ├─► INSERT assets (business_id, name, purchase_date, purchase_amount…)│
│       │                                                                     │
│       ├─► post_asset_purchase_to_ledger(p_asset_id, p_payment_account_id)    │
│       │        │                                                            │
│       │        ├─ assert_accounting_period_is_open(business_id, purchase_date)│  ← 290
│       │        ├─ DR Fixed Assets (1600)                                     │
│       │        ├─ CR Cash (1010) or payment_account_id                       │
│       │        └─ UPDATE assets SET acquisition_journal_entry_id = JE id     │  ← 290
│       │                                                                     │
│       │   ON FAILURE (after 290 + API fix):                                 │
│       │   DELETE asset, return 500 with ledger error                        │
│       │                                                                     │
│       └─► Optional backfilled depreciation_entries + post_depreciation_…    │
│            (logged on failure; asset already committed with acquisition JE) │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Canonical posting (acquisition):**
- **DR** Fixed Asset Account (1600)  
- **CR** Cash / Payables (1010 or `payment_account_id`)

---

## 3. Depreciation → Ledger Flow Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ DEPRECIATION (manual or backfill from create)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  app/api/assets/[id]/depreciation/route.ts  OR  create/route (backfill)     │
│       │                                                                     │
│       ├─► INSERT depreciation_entries (asset_id, business_id, date, amount) │
│       │                                                                     │
│       └─► post_depreciation_to_ledger(p_depreciation_entry_id)              │
│                │                                                            │
│                ├─ IF depreciation_entries.journal_entry_id IS NOT NULL       │
│                │     RAISE 'Depreciation entry already posted'               │  ← 290
│                ├─ assert_accounting_period_is_open(business_id, entry date)  │  ← 290
│                ├─ DR Depreciation Expense (5700)                            │
│                ├─ CR Accumulated Depreciation (1650)                         │
│                └─ UPDATE depreciation_entries SET journal_entry_id = JE id  │
│                                                                             │
│            ON FAILURE (after API fix):                                      │
│            DELETE depreciation_entries row, return 500 with ledger error     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Canonical posting (depreciation):**
- **DR** Depreciation Expense (5700)  
- **CR** Accumulated Depreciation (1650)

---

## 4. Asset Disposal Flow (unchanged contract, period enforced)

```
post_asset_disposal_to_ledger(p_asset_id, p_disposal_amount, p_payment_account_id)
  ├─ assert_accounting_period_is_open(business_id, disposal_date)   ← 290
  ├─ Sum depreciation_entries (deleted_at IS NULL)                    ← 290
  ├─ Proceeds → Cash; Remove Accumulated Depreciation; Remove Asset │
  └─ Gain (4100) or Loss (5800)
```

Disposal API already returned 500 on ledger error; no API change.

---

## 5. Asset Storage Audit (Tables)

| Table                         | Ledger linkage pre-290 | After 290 / existing |
|------------------------------|------------------------|----------------------|
| **assets**                   | No journal id          | `acquisition_journal_entry_id` → `journal_entries(id)` |
| **asset_categories**         | N/A (reference only)   | No change            |
| **depreciation_entries**     | `journal_entry_id`     | Unchanged; used for duplicate guard |

- Asset **does** store ledger link for acquisition (after migration 290).
- Depreciation **does** store `journal_entry_id`; RPC now refuses to post if already set.

---

## 6. Defect Classification & Resolution

| # | Check | Severity | Result | Evidence / Fix |
|---|--------|----------|--------|----------------|
| 1 | Asset creates journal | CRITICAL | Was possible to have asset without journal (errors swallowed) | **Fixed:** Create API fails and deletes asset if `post_asset_purchase_to_ledger` fails. |
| 2 | Ledger account mapping exists | — | Yes | 1600 Fixed Assets, 1650 Accumulated Depreciation, 5700 Depreciation Expense, 1010 Cash, 4100/5800 gain/loss. |
| 3 | Asset purchase linking | MEDIUM | No acquisition JE id on asset | **Fixed:** 290 adds `acquisition_journal_entry_id`; RPC sets it after posting. |
| 4 | Posting via posting engine | — | Yes | RPCs insert into `journal_entries` + `journal_entry_lines` (canonical path). |
| 5 | Depreciation posts | HIGH | Could fail silently; could double-post | **Fixed:** 290 period + idempotency; API returns 500 and deletes entry on post failure. |
| 6 | Period lock enforcement | HIGH | Missing in asset/depreciation RPCs | **Fixed:** 290 adds `assert_accounting_period_is_open` in all three RPCs. |
| 7 | Duplicate posting protection | MEDIUM | Depreciation could be posted twice | **Fixed:** 290 raises if `depreciation_entries.journal_entry_id` already set. |
| 8 | Ledger visibility (TB, P&L, BS) | — | Yes | JEs flow to ledger; TB/P&L/BS read from same ledger; no change. |

---

## 7. Implemented Patches

### 7.1 Migration 290 (`290_asset_ledger_period_and_linkage.sql`)

- **assets:** `acquisition_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL`, indexed.
- **post_asset_purchase_to_ledger:** Uses `purchase_date` from `assets`; calls `assert_accounting_period_is_open(v_business_id, v_purchase_date)`; journal date = purchase date; Fixed Assets 1600; after insert, `UPDATE assets SET acquisition_journal_entry_id = v_journal_entry_id`.
- **post_depreciation_to_ledger:** Raises if `depreciation_entries.journal_entry_id` is already set; calls `assert_accounting_period_is_open(v_business_id, v_date)`; otherwise unchanged (DR 5700, CR 1650, update `journal_entry_id`).
- **post_asset_disposal_to_ledger:** Calls `assert_accounting_period_is_open(v_business_id, v_disposal_date)`; Fixed Assets 1600; sums only `depreciation_entries` with `deleted_at IS NULL`; gain 4100, loss 5800.

### 7.2 API

- **Asset create:** On `post_asset_purchase_to_ledger` error or no `journalEntryId`: delete the newly created asset, return 500 with ledger error message. Asset cannot exist without acquisition journal.
- **Depreciation (manual):** On `post_depreciation_to_ledger` error: delete the new `depreciation_entries` row, return 500 with error message.
- **Disposal:** No change (already returns 500 on ledger failure).

---

## 8. Missing Enforcement Points (Addressed)

| Gap | Addressed by |
|-----|----------------|
| Acquisition could succeed without ledger | Create API fails and rolls back asset if post fails. |
| Depreciation could succeed without ledger | Depreciation API fails and deletes entry if post fails. |
| No period check on asset/depreciation/disposal | 290: `assert_accounting_period_is_open` in all three RPCs. |
| Depreciation double-post | 290: idempotency check on `journal_entry_id` in `post_depreciation_to_ledger`. |
| No audit trail from asset to acquisition JE | 290: `assets.acquisition_journal_entry_id` set by RPC. |

---

## 9. Regression Risk Assessment

- **Low:** Migration is additive (new column, stricter RPCs). Existing journal contract and ledger schema unchanged.
- **Medium:** APIs now return 500 when period is closed or accounts missing; clients must handle these errors (e.g. “Open the accounting period for the purchase date”).
- **Mitigation:** Clear error messages; no silent failures. Backfilled depreciation on create still logs only (no full request rollback) to avoid blocking asset creation when only backdated depreciation fails.

---

## 10. Ledger Integrity Confirmation

- **Immutable:** No change to ledger schema or journal mutation rules.
- **Posting-engine controlled:** All asset/depreciation/disposal posts go through the same RPCs inserting into `journal_entries` and `journal_entry_lines`.
- **Period-locked:** All three RPCs call `assert_accounting_period_is_open` for the relevant date.
- **Audit-traceable:** Assets link to acquisition JE; depreciation_entries link to depreciation JE; reference_type/reference_id and posting_source preserved.

Assets are now **ledger-dependent**: an asset is not persisted without a successful acquisition journal, and a depreciation entry is not persisted without a successful depreciation journal.

---

## 11. Validation Checklist (Post-Patch)

| Check | Status |
|-------|--------|
| Asset acquisition creates balanced journal (DR 1600, CR 1010/payment) | ✓ RPC unchanged logic; period enforced. |
| Depreciation creates journal (DR 5700, CR 1650) | ✓ RPC unchanged; duplicate guard + period. |
| Trial Balance reflects asset balances | ✓ JEs in ledger. |
| P&L reflects depreciation expense | ✓ 5700 expense in JEs. |
| Balance Sheet reflects accumulated depreciation | ✓ 1650 in JEs. |
| Period lock blocks depreciation posting | ✓ `assert_accounting_period_is_open` in RPC. |
| Duplicate depreciation cannot occur | ✓ RPC raises if `journal_entry_id` already set; API deletes entry on post failure. |
| Asset cannot exist without acquisition journal | ✓ Create API deletes asset and returns 500 on post failure. |

---

## 12. File Reference

| Area | File |
|------|------|
| Asset create API | `app/api/assets/create/route.ts` |
| Depreciation API | `app/api/assets/[id]/depreciation/route.ts` |
| Disposal API | `app/api/assets/[id]/dispose/route.ts` |
| Schema (assets, depreciation_entries) | `supabase/migrations/046_asset_register.sql`, `251_*` |
| Posting RPCs (before 290) | `supabase/migrations/190_fix_posting_source_default_bug.sql` |
| Period + linkage + idempotency | `supabase/migrations/290_asset_ledger_period_and_linkage.sql` |

---

*End of report.*
