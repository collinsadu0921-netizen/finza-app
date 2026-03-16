# Posting Granularity Decision — Multi-Store Safe Analysis

**Date:** 2025-01-27  
**Type:** Analysis + Decision Only (No Code Changes)  
**Purpose:** Formally decide accounting posting granularity for Finza Retail under Option B (event-based accounting)

---

## CONTEXT (LOCKED FACTS)

- Retail emits **immutable accounting events**
- VAT is calculated **only in Retail** (canonical tax engine)
- Ghana VAT is **regime-versioned** (pre-2026 compound, post-2026 simplified)
- COVID levy does **not** exist in current regime
- Retail supports **multiple stores per business**
- Accounting must consume events **after the fact**, not at sale time
- Current implementation: **Per-sale posting** (immediate, transactional)

---

## CURRENT STATE EVIDENCE

**Sale Creation Flow** (`app/api/sales/create/route.ts`):
- Lines 400-419: Sale record created in `sales` table
- Lines 544-1064: Sale items created, stock deducted
- Lines 1066-1123: **Calls `post_sale_to_ledger(sale_id)` immediately**
- If posting fails → Sale is **rolled back** (deleted)
- Validation: `validate_sale_reconciliation(sale_id)` after posting

**Period Validation**:
- `post_sale_to_ledger()` calls `assert_accounting_period_is_open(business_id, sale_date)` at line 542
- Blocks if period is `locked`
- Allows if period is `open` or `soft_closed`

**Multi-Store Support**:
- `sales.store_id` links sales to stores (migration `028_ensure_store_id_columns.sql`)
- `sales.cashier_session_id` links sales to register sessions
- `sales.register_id` links sales to registers
- Store-specific VAT reports filter by `store_id`

**Register Closing** (`app/api/register/close/route.ts`):
- Closes `cashier_sessions` (sets `status = 'closed'`)
- Records `closing_amount`, `closing_cash`, `ended_at`
- **Does NOT trigger ledger posting**
- **Does NOT aggregate sales for posting**

**Sales Aggregation**:
- No existing batching or aggregation logic
- Each sale posts independently
- Journal entries have `reference_type = 'sale'` and `reference_id = sale.id`

---

## OPTION 1: PER SALE POSTING

### 1.1 Operational Impact (Retail)

**POS Availability:**
- ✅ **High availability** - Each sale is independent
- ✅ **No blocking** - Sale creation succeeds or fails atomically
- ❌ **Failure impact** - If posting fails, entire sale is rolled back (including stock deduction)

**Failure Blast Radius:**
- **Scope:** Single sale only
- **Impact:** If period locked or account missing, that one sale fails
- **Rollback:** Complete (sale + items + stock movements deleted)
- **Recovery:** Sale must be re-entered manually

**Multi-Store Operations:**
- ✅ **Store isolation** - Each sale is independent per store
- ✅ **No cross-store coupling** - Store A failure doesn't affect Store B
- ✅ **Parallel operations** - Multiple stores can post simultaneously
- ✅ **Store-specific validation** - Period/account validation per sale

**Accounting Misconfiguration:**
- **Impact:** Immediate failure on first sale attempt
- **Visibility:** Clear error message (period locked, account missing)
- **Recovery:** Must fix accounting setup before sales can proceed
- **Partial state:** No partial sales in database (rollback ensures consistency)

---

### 1.2 Accounting Correctness

**Period Enforcement Timing:**
- ✅ **Immediate validation** - Period checked at sale time
- ✅ **Accurate date** - Uses `sale.created_at::DATE` for period lookup
- ❌ **Period lock blocks sales** - If period locked during day, sales fail immediately
- ✅ **Soft close allowed** - Sales can post to `soft_closed` periods

**VAT Accuracy and Reconciliation:**
- ✅ **Exact VAT per sale** - Each sale's tax_lines posted exactly as calculated
- ✅ **No aggregation errors** - No rounding errors from summing
- ✅ **Audit trail** - Each sale traceable to specific journal entry
- ✅ **VAT report matches ledger** - VAT reports read from `sales.tax_lines`, ledger posts same data

**Risk of Imbalance or Partial Posting:**
- ✅ **Atomic posting** - `post_journal_entry()` validates debits = credits
- ✅ **No partial state** - Sale either fully posted or not posted (rollback on failure)
- ❌ **High entry volume** - Many journal entries for high-volume stores

**Alignment with Accountant Workflows:**
- ✅ **Granular audit trail** - Each sale individually traceable
- ❌ **High noise** - Many entries for period close review
- ✅ **Adjustment precision** - Easy to identify and adjust specific sale
- ✅ **Real-time ledger** - Ledger always current (no lag)

---

### 1.3 Multi-Store Safety Analysis

**Can stores be posted independently?**
- ✅ **Yes** - Each sale posts independently, no cross-store dependencies
- ✅ **Store isolation** - `sales.store_id` ensures store-specific filtering
- ✅ **Independent failures** - Store A can fail while Store B succeeds

**Can one store fail while others succeed?**
- ✅ **Yes** - Period validation is per-business (not per-store), but sale failures are isolated
- ✅ **Partial failure** - If Store A's period is locked, Store B can still post
- ⚠️ **Business-level blocking** - If business period is locked, ALL stores blocked

**Is there any risk of cross-store data mixing?**
- ✅ **No** - Each sale has explicit `store_id`
- ✅ **Journal entries reference sale** - Can trace back to store via `reference_id`
- ⚠️ **Cash account shared** - All stores post to same CASH account (business-level)

**Does the option scale with many stores?**
- ✅ **Yes** - No coordination needed between stores
- ❌ **High volume** - N stores × M sales/day = N×M journal entries
- ✅ **Parallel posting** - No contention between stores
- ❌ **Period lock blocks all** - Business-level period lock affects all stores

---

### 1.4 Idempotency & Replay Safety

**Natural Idempotency Key:**
- ✅ **Sale ID** - `reference_type = 'sale'` and `reference_id = sale.id`
- ✅ **Unique constraint** - One journal entry per sale (enforced by business logic)
- ✅ **Re-post detection** - `post_journal_entry()` can check if entry already exists

**How re-posting is prevented:**
- ✅ **Existence check** - Can check `journal_entries` for existing `reference_type = 'sale'` AND `reference_id = sale.id`
- ⚠️ **Current implementation** - Does NOT check for existing entry (could double-post)
- ✅ **Natural idempotency** - Re-calling `post_sale_to_ledger()` with same `sale_id` reads same sale data

**How failed postings are retried:**
- ✅ **Retry safe** - Sale data immutable (read same values on retry)
- ✅ **Idempotent function** - `post_sale_to_ledger()` can be called multiple times safely if existence check added
- ❌ **Current issue** - No retry mechanism (failed sales are rolled back and lost)

**How partial failures are isolated:**
- ✅ **Atomic per sale** - Each sale is independent transaction
- ✅ **Rollback on failure** - Failed sale deleted completely
- ✅ **No partial state** - Either fully posted or not posted

---

### 1.5 Ledger Quality Impact

**Ledger Noise (Entry Volume):**
- ❌ **Very high** - One entry per sale
- **Example:** 100 sales/day = 100 journal entries/day = 3,000 entries/month
- ❌ **Hard to read** - Period close review requires reviewing many entries
- ✅ **Granular detail** - Full audit trail of every sale

**Audit Readability:**
- ✅ **Excellent** - Each sale individually traceable
- ✅ **Clear reference** - `reference_type = 'sale'` and `reference_id = sale.id`
- ❌ **Too granular** - Accountants typically want daily summaries, not per-sale detail
- ✅ **Searchable** - Easy to find specific sale in ledger

**Adjustment Complexity:**
- ✅ **Simple** - Identify specific sale, reverse it, post adjustment
- ✅ **Precise** - Can adjust single sale without affecting others
- ✅ **Clear audit trail** - Adjustment references original sale ID

**Period Close Workflow:**
- ❌ **Labor-intensive** - Must review many entries per period
- ✅ **Complete visibility** - All sales visible before close
- ❌ **High volume** - Closing period with 3,000+ entries is tedious
- ✅ **No aggregation needed** - Ledger already has all detail

---

## OPTION 2: PER REGISTER / SHIFT POSTING

### 2.1 Operational Impact (Retail)

**POS Availability:**
- ✅ **High availability during shift** - Sales succeed regardless of accounting status
- ❌ **Blocking at close** - Register cannot be closed if posting fails
- ⚠️ **Delayed failure** - Accounting problems discovered at shift end, not sale time
- ✅ **No sale rollback** - Sales are already committed when posting happens

**Failure Blast Radius:**
- **Scope:** All sales in one cashier session (entire shift)
- **Impact:** If period locked or account missing at close, entire shift cannot be posted
- **Recovery:** Must keep shift open until accounting fixed, or post manually later
- **Partial state:** Sales exist in database but not in ledger (reconciliation gap)

**Multi-Store Operations:**
- ✅ **Store isolation** - Each register session is store-specific
- ✅ **Independent shifts** - Store A can close while Store B is still open
- ⚠️ **Shift-dependent** - Sales cannot be posted until shift closes
- ✅ **Store-specific aggregation** - Each shift aggregates sales for one store

**Accounting Misconfiguration:**
- **Impact:** Discovered at shift close, not at sale time
- **Visibility:** Error message at close (period locked, account missing)
- **Recovery:** Sales remain in database, can post manually later
- **Partial state:** Operational data exists, ledger missing

---

### 2.2 Accounting Correctness

**Period Enforcement Timing:**
- ⚠️ **Delayed validation** - Period checked at shift close, not sale time
- ⚠️ **Date ambiguity** - Shift may span multiple days (which date to use?)
- ❌ **Period lock discovered late** - If period locked during shift, discovered at close
- ✅ **Soft close allowed** - Shifts can close to `soft_closed` periods

**VAT Accuracy and Reconciliation:**
- ✅ **Aggregated VAT** - Sum of all sale tax_lines in shift
- ⚠️ **Rounding considerations** - Must sum tax amounts (potential rounding differences)
- ✅ **Audit trail** - Can trace journal entry back to shift and all sales
- ⚠️ **VAT report mismatch** - VAT reports read per-sale, ledger has aggregated entry

**Risk of Imbalance or Partial Posting:**
- ✅ **Atomic posting** - Single journal entry for entire shift
- ⚠️ **Partial shift posting** - If shift has uncommitted sales, aggregation may be incomplete
- ❌ **High failure impact** - One shift failure affects many sales

**Alignment with Accountant Workflows:**
- ✅ **Shift-level review** - Matches cash reconciliation workflow
- ✅ **Lower entry volume** - Fewer entries than per-sale
- ✅ **Shift closure alignment** - Matches register close workflow
- ❌ **Multi-day shifts** - Shifts spanning days complicate period assignment

---

### 2.3 Multi-Store Safety Analysis

**Can stores be posted independently?**
- ✅ **Yes** - Each shift is store-specific (`cashier_sessions.store_id`)
- ✅ **Store isolation** - Shift aggregation per store
- ✅ **Independent close** - Store A can close shift while Store B is open

**Can one store fail while others succeed?**
- ✅ **Yes** - Shift close failures are isolated per register
- ✅ **Partial failure** - Store A shift can fail while Store B succeeds
- ⚠️ **Business-level blocking** - If business period is locked, ALL shifts blocked

**Is there any risk of cross-store data mixing?**
- ✅ **No** - Each shift has explicit `store_id` (from `cashier_sessions`)
- ✅ **Journal entries reference shift** - Can trace back to store via `reference_id`
- ⚠️ **Cash account shared** - All stores post to same CASH account (business-level)

**Does the option scale with many stores?**
- ✅ **Yes** - No coordination needed between shifts
- ✅ **Lower volume** - N stores × K shifts/day = N×K journal entries (K << M sales)
- ✅ **Parallel posting** - Shifts can close independently
- ❌ **Period lock blocks all** - Business-level period lock affects all stores

---

### 2.4 Idempotency & Replay Safety

**Natural Idempotency Key:**
- ✅ **Cashier Session ID** - `reference_type = 'cashier_session'` and `reference_id = session.id`
- ✅ **Unique constraint** - One journal entry per session (enforced by business logic)
- ✅ **Re-post detection** - `post_journal_entry()` can check if entry already exists

**How re-posting is prevented:**
- ✅ **Existence check** - Can check `journal_entries` for existing `reference_type = 'cashier_session'` AND `reference_id = session.id`
- ✅ **Session status** - `cashier_sessions.status = 'closed'` indicates shift complete
- ⚠️ **Re-close prevention** - Cannot close same session twice (current logic prevents)

**How failed postings are retried:**
- ✅ **Retry safe** - Shift sales immutable once shift closed
- ✅ **Idempotent function** - Can re-aggregate same shift sales safely
- ✅ **Retry mechanism** - Can manually trigger posting for failed shifts

**How partial failures are isolated:**
- ✅ **Atomic per shift** - Each shift is independent
- ⚠️ **Partial posting** - Sales exist in database but not in ledger if posting fails
- ✅ **Isolated failures** - One shift failure doesn't affect others

---

### 2.5 Ledger Quality Impact

**Ledger Noise (Entry Volume):**
- ✅ **Moderate** - One entry per shift
- **Example:** 3 shifts/day × 30 days = 90 journal entries/month (vs 3,000 for per-sale)
- ✅ **Readable** - Accountants can review shift-level summaries
- ⚠️ **Less granular** - Cannot see individual sale detail in ledger

**Audit Readability:**
- ✅ **Good** - Shift-level summaries align with cash reconciliation
- ✅ **Clear reference** - `reference_type = 'cashier_session'` and `reference_id = session.id`
- ⚠️ **Less granular** - Must trace to `sales` table to see individual sales
- ✅ **Shift alignment** - Matches register close workflow

**Adjustment Complexity:**
- ⚠️ **Complex** - Must reverse entire shift, then re-post with adjustment
- ⚠️ **Less precise** - Cannot adjust single sale without affecting shift
- ✅ **Shift-level adjustments** - Common for cash variances

**Period Close Workflow:**
- ✅ **Manageable** - Reviewing 90 entries/month is reasonable
- ✅ **Shift summaries** - Can review shift totals before close
- ⚠️ **Open shifts** - Must ensure all shifts closed before period close
- ✅ **Cash reconciliation** - Aligns with register reconciliation workflow

---

## OPTION 3: PER STORE × PER DAY POSTING

### 3.1 Operational Impact (Retail)

**POS Availability:**
- ✅ **Maximum availability** - Sales always succeed, accounting decoupled
- ✅ **No blocking** - Accounting problems never block sales
- ✅ **Delayed posting** - Accounting can be fixed before daily posting
- ✅ **No sale rollback** - Sales are always committed

**Failure Blast Radius:**
- **Scope:** All sales for one store on one calendar day
- **Impact:** If period locked or account missing, entire day cannot be posted
- **Recovery:** Can post manually later (sales already in database)
- **Partial state:** Operational data exists, ledger missing for that day

**Multi-Store Operations:**
- ✅ **Store isolation** - Each store-day is independent
- ✅ **Independent posting** - Store A can post while Store B fails
- ✅ **Store-specific aggregation** - Each store posts independently
- ✅ **No cross-store dependencies** - Store failures isolated

**Accounting Misconfiguration:**
- **Impact:** Discovered at daily posting (not during sales)
- **Visibility:** Error message at posting time (period locked, account missing)
- **Recovery:** Sales remain in database, can post manually later
- **Partial state:** Operational data exists, ledger missing

---

### 3.2 Accounting Correctness

**Period Enforcement Timing:**
- ⚠️ **Delayed validation** - Period checked at daily posting, not sale time
- ✅ **Date accuracy** - Uses calendar date (no ambiguity)
- ❌ **Period lock discovered late** - If period locked during day, discovered at posting
- ✅ **Soft close allowed** - Days can post to `soft_closed` periods

**VAT Accuracy and Reconciliation:**
- ✅ **Aggregated VAT** - Sum of all sale tax_lines for store-day
- ⚠️ **Rounding considerations** - Must sum tax amounts (potential rounding differences)
- ✅ **Audit trail** - Can trace journal entry back to all sales for store-day
- ⚠️ **VAT report mismatch** - VAT reports read per-sale, ledger has aggregated entry

**Risk of Imbalance or Partial Posting:**
- ✅ **Atomic posting** - Single journal entry for entire store-day
- ⚠️ **Partial day posting** - If day has uncommitted sales, aggregation may be incomplete
- ⚠️ **Time boundary** - Sales near midnight may belong to different days

**Alignment with Accountant Workflows:**
- ✅ **Daily summaries** - Matches typical accounting workflow
- ✅ **Lowest entry volume** - One entry per store per day
- ✅ **Period close alignment** - Daily posting aligns with period boundaries
- ✅ **Standard practice** - Common in retail accounting systems

---

### 3.3 Multi-Store Safety Analysis

**Can stores be posted independently?**
- ✅ **Yes** - Each store-day is independent
- ✅ **Store isolation** - `store_id` ensures store-specific filtering
- ✅ **Independent posting** - Store A can post while Store B fails

**Can one store fail while others succeed?**
- ✅ **Yes** - Store-day failures are isolated
- ✅ **Partial failure** - Store A day can fail while Store B succeeds
- ⚠️ **Business-level blocking** - If business period is locked, ALL store-days blocked

**Is there any risk of cross-store data mixing?**
- ✅ **No** - Each store-day has explicit `store_id`
- ✅ **Journal entries reference store-day** - Can trace back to store via description/reference
- ⚠️ **Cash account shared** - All stores post to same CASH account (business-level)

**Does the option scale with many stores?**
- ✅ **Yes** - No coordination needed between stores
- ✅ **Lowest volume** - N stores × 1 entry/day = N entries/day (vs N×M for per-sale)
- ✅ **Parallel posting** - Stores can post independently
- ❌ **Period lock blocks all** - Business-level period lock affects all stores

---

### 3.4 Idempotency & Replay Safety

**Natural Idempotency Key:**
- ✅ **Store ID + Date** - `reference_type = 'store_day'` and `reference_id = store_id + date`
- ✅ **Unique constraint** - One journal entry per store per day (enforced by business logic)
- ✅ **Re-post detection** - `post_journal_entry()` can check if entry already exists

**How re-posting is prevented:**
- ✅ **Existence check** - Can check `journal_entries` for existing `reference_type = 'store_day'` AND date range
- ✅ **Date boundary** - Calendar date ensures clear boundaries
- ⚠️ **Time zone considerations** - Must handle time zones consistently

**How failed postings are retried:**
- ✅ **Retry safe** - Day's sales immutable (read same values on retry)
- ✅ **Idempotent function** - Can re-aggregate same store-day sales safely
- ✅ **Retry mechanism** - Can manually trigger posting for failed days

**How partial failures are isolated:**
- ✅ **Atomic per store-day** - Each store-day is independent
- ⚠️ **Partial posting** - Sales exist in database but not in ledger if posting fails
- ✅ **Isolated failures** - One store-day failure doesn't affect others

---

### 3.5 Ledger Quality Impact

**Ledger Noise (Entry Volume):**
- ✅ **Lowest** - One entry per store per day
- **Example:** 3 stores × 30 days = 90 journal entries/month (vs 3,000 for per-sale)
- ✅ **Highly readable** - Accountants can review daily summaries easily
- ✅ **Standard practice** - Common in retail accounting

**Audit Readability:**
- ✅ **Excellent** - Daily summaries align with accounting workflows
- ✅ **Clear reference** - `reference_type = 'store_day'` and description includes store + date
- ⚠️ **Less granular** - Must trace to `sales` table to see individual sales
- ✅ **Period alignment** - Daily entries align with period boundaries

**Adjustment Complexity:**
- ⚠️ **Complex** - Must reverse entire day, then re-post with adjustment
- ⚠️ **Less precise** - Cannot adjust single sale without affecting day
- ✅ **Daily adjustments** - Common for daily reconciliation variances

**Period Close Workflow:**
- ✅ **Optimal** - Reviewing 90 entries/month is very manageable
- ✅ **Daily summaries** - Can review daily totals before period close
- ✅ **Complete days** - All days in period posted before close
- ✅ **Standard workflow** - Matches typical retail accounting practice

---

## COMPARATIVE ANALYSIS

### Operational Impact Summary

| Aspect | Option 1: Per Sale | Option 2: Per Shift | Option 3: Per Store-Day |
|--------|-------------------|---------------------|------------------------|
| POS Availability | High (immediate validation) | High (delayed validation) | Maximum (fully decoupled) |
| Failure Blast Radius | Single sale | Entire shift | Entire store-day |
| Multi-Store Isolation | Excellent | Excellent | Excellent |
| Accounting Blocking | Immediate | At shift close | At daily posting |

### Accounting Correctness Summary

| Aspect | Option 1: Per Sale | Option 2: Per Shift | Option 3: Per Store-Day |
|--------|-------------------|---------------------|------------------------|
| Period Enforcement | Immediate | Delayed | Delayed |
| VAT Accuracy | Exact (no rounding) | Aggregated (rounding risk) | Aggregated (rounding risk) |
| Audit Trail | Granular | Shift-level | Day-level |
| Entry Volume | Very high | Moderate | Lowest |

### Multi-Store Safety Summary

| Aspect | Option 1: Per Sale | Option 2: Per Shift | Option 3: Per Store-Day |
|--------|-------------------|---------------------|------------------------|
| Store Independence | ✅ Yes | ✅ Yes | ✅ Yes |
| Failure Isolation | ✅ Per sale | ✅ Per shift | ✅ Per store-day |
| Cross-Store Risk | ✅ None | ✅ None | ✅ None |
| Scalability | ❌ High volume | ✅ Moderate volume | ✅ Lowest volume |

### Idempotency & Replay Safety Summary

| Aspect | Option 1: Per Sale | Option 2: Per Shift | Option 3: Per Store-Day |
|--------|-------------------|---------------------|------------------------|
| Natural Key | Sale ID | Session ID | Store ID + Date |
| Re-post Prevention | ✅ Existence check | ✅ Existence check | ✅ Existence check |
| Retry Safety | ✅ Yes | ✅ Yes | ✅ Yes |
| Partial Failure | ✅ Isolated | ⚠️ Partial posting | ⚠️ Partial posting |

### Ledger Quality Summary

| Aspect | Option 1: Per Sale | Option 2: Per Shift | Option 3: Per Store-Day |
|--------|-------------------|---------------------|------------------------|
| Entry Volume | ❌ Very high (3,000/month) | ✅ Moderate (90/month) | ✅ Lowest (90/month) |
| Audit Readability | ⚠️ Too granular | ✅ Good | ✅ Excellent |
| Adjustment Complexity | ✅ Simple | ⚠️ Complex | ⚠️ Complex |
| Period Close Workflow | ❌ Labor-intensive | ✅ Manageable | ✅ Optimal |

---

## DECISION FACTORS

### Requirements Analysis

**Must Work with Multiple Stores:**
- ✅ All three options support multi-store independently
- ✅ All three isolate store failures
- ✅ All three scale to many stores

**Must NOT Break Existing Retail or VAT Flows:**
- ⚠️ **Option 1** - Already implemented, no breaking changes
- ❌ **Option 2** - Requires shift-close posting trigger (not currently implemented)
- ❌ **Option 3** - Requires daily posting trigger (not currently implemented)
- ⚠️ All options require changes to posting timing

**Must Align with Real-World Retail Accounting Practice:**
- ⚠️ **Option 1** - Too granular for most accountants
- ✅ **Option 2** - Aligns with shift/cash reconciliation workflow
- ✅ **Option 3** - Standard practice (daily summaries)

**Must Avoid Runtime Coupling Between POS and Accounting:**
- ❌ **Option 1** - Tight coupling (immediate posting blocks sales)
- ⚠️ **Option 2** - Moderate coupling (posting at shift close)
- ✅ **Option 3** - Minimal coupling (posting decoupled from sales)

**Must Be Provably Idempotent and Replay-Safe:**
- ✅ **Option 1** - Natural idempotency (sale ID)
- ✅ **Option 2** - Natural idempotency (session ID)
- ✅ **Option 3** - Natural idempotency (store ID + date)

### Key Trade-offs

**Granularity vs. Volume:**
- Option 1: Maximum granularity, maximum volume
- Option 2: Moderate granularity, moderate volume
- Option 3: Low granularity, lowest volume

**Immediate Validation vs. Decoupling:**
- Option 1: Immediate validation (tight coupling)
- Option 2: Delayed validation (moderate coupling)
- Option 3: Delayed validation (minimal coupling)

**VAT Accuracy vs. Rounding:**
- Option 1: Exact VAT (no rounding)
- Option 2: Aggregated VAT (rounding risk)
- Option 3: Aggregated VAT (rounding risk)

**Audit Trail vs. Readability:**
- Option 1: Maximum detail, hard to read
- Option 2: Shift-level detail, readable
- Option 3: Daily detail, highly readable

---

## RECOMMENDATION

### Selected Posting Granularity: **Option 3 — Per Store × Per Day Posting**

### Rationale

**1. Minimal Runtime Coupling:**
- Sales succeed independently of accounting status
- Accounting problems never block POS operations
- Accounting can be fixed before daily posting
- Aligns with event-based accounting architecture (Option B)

**2. Multi-Store Safety:**
- Each store-day is independent
- Store failures are isolated
- Scales to many stores (lowest entry volume)
- No cross-store dependencies

**3. Real-World Alignment:**
- Standard practice in retail accounting
- Matches daily reconciliation workflows
- Accountants expect daily summaries
- Period close workflow is optimal

**4. Idempotency & Replay Safety:**
- Natural key: Store ID + Calendar Date
- Clear boundaries (calendar date)
- Safe retry mechanism
- Existence check prevents double-posting

**5. Ledger Quality:**
- Lowest entry volume (manageable for period close)
- Highly readable daily summaries
- Standard accounting practice
- Optimal for accountant workflows

### Trade-offs Accepted

**1. Delayed Period Validation:**
- Period locked during day discovered at posting (not at sale time)
- **Mitigation:** Period locks typically happen at month-end, not mid-day
- **Mitigation:** Sales remain in database, can post manually later

**2. Aggregated VAT (Rounding Risk):**
- VAT summed across all sales (potential rounding differences)
- **Mitigation:** Rounding differences are minimal and acceptable in practice
- **Mitigation:** VAT reports still read per-sale for accuracy

**3. Less Granular Audit Trail:**
- Must trace to `sales` table to see individual sales
- **Mitigation:** Individual sales still in `sales` table (operational data)
- **Mitigation:** Daily summaries are sufficient for most audits

**4. Adjustment Complexity:**
- Must reverse entire day, then re-post with adjustment
- **Mitigation:** Daily adjustments are common in retail accounting
- **Mitigation:** Individual sale corrections can use adjusting journals

### Implementation Notes

**Posting Trigger:**
- Must implement daily posting job/batch process
- Runs once per day per store (can run in parallel)
- Can be scheduled or manual trigger

**Natural Idempotency Key:**
- `reference_type = 'store_day'`
- `reference_id = store_id + '_' + date` (or composite key)
- Description: `"Retail sales - Store: {store_name} - Date: {date}"`

**Sales Aggregation:**
- Filter: `sales.store_id = {store_id}` AND `DATE(sales.created_at) = {date}`
- Sum revenue, COGS, inventory, tax_lines per tax code
- Single journal entry with aggregated amounts

**Failed Posting Handling:**
- Sales remain in database (not rolled back)
- Can retry posting manually
- Reconciliation gap visible (operational data exists, ledger missing)

**Period Assignment:**
- Use calendar date for period lookup
- `assert_accounting_period_is_open(business_id, date)`
- Handles multi-day periods correctly

---

## CONCLUSION

**SELECTED POSTING GRANULARITY: Option 3 — Per Store × Per Day Posting**

This option provides the best balance of:
- ✅ Minimal runtime coupling (sales decoupled from accounting)
- ✅ Multi-store safety (independent store-day posting)
- ✅ Real-world alignment (standard retail accounting practice)
- ✅ Optimal ledger quality (manageable entry volume)
- ✅ Idempotency & replay safety (natural key: store + date)

The trade-offs (delayed validation, aggregated VAT, less granular audit trail) are acceptable and align with real-world retail accounting workflows.

---

**End of Analysis**
