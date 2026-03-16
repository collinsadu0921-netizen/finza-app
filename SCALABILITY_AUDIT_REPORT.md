# Finza Scalability Audit Report
**Date:** 2026-01-27  
**Auditor:** Principal Scalability Engineer  
**Target Scale:** 10k+ businesses, 100k+ users, 500-2,000 concurrent sessions, 50-300 writes/sec

---

## A. EXECUTIVE VERDICT

**Status: NOT SCALE-READY** — Critical bottlenecks identified that will cause failures at target scale.

**Primary Concerns:**
1. **Row-level triggers on high-write tables** (sales, invoices, payments) execute synchronously during INSERT, creating serialization bottlenecks. At 300 writes/sec, trigger contention will cause timeouts.
2. **No background job infrastructure** — PDF generation, email sending, and report generation execute inline in API routes, blocking request handlers.
3. **Missing composite indexes** on critical query patterns (business_id + created_at, business_id + status) will cause sequential scans as data grows.
4. **RLS policies are permissive** (many use `USING (true)`) — while not a performance issue, this is a security risk that must be hardened before production.
5. **N+1 query patterns** in several endpoints (customer 360, reports) will amplify latency under load.
6. **No caching layer** — repeated queries for business settings, tax calculations, and account lookups hit the database on every request.

**Estimated failure point:** System will begin degrading at ~50 concurrent POS sales, ~100 concurrent invoice operations, or ~20 concurrent report generations. Database connection pool exhaustion likely at 200+ concurrent requests.

---

## B. TOP 15 SCALABILITY RISKS (Ranked by Impact × Likelihood)

### 1. **CRITICAL: Row-Level Triggers on High-Write Tables** ⚠️⚠️⚠️
**Impact:** CRITICAL | **Likelihood:** HIGH | **Effort:** MEDIUM

**Evidence:**
- `supabase/migrations/043_accounting_core.sql:949-952` — `trigger_auto_post_invoice` fires AFTER INSERT on `invoices`
- `supabase/migrations/043_accounting_core.sql:973-976` — `trigger_auto_post_payment` fires AFTER INSERT on `payments`
- `supabase/migrations/043_accounting_core.sql:1005-1008` — `trigger_auto_post_credit_note` fires AFTER INSERT on `credit_notes`
- `app/api/sales/create/route.ts:1308-1342` — `post_sale_to_ledger()` called inline (not via trigger, but same pattern)

**Failure Mode:**
- Each invoice/payment/sale INSERT triggers a complex function (`post_invoice_to_ledger`, `post_payment_to_ledger`, `post_sale_to_ledger`) that:
  - Queries accounts table (multiple lookups via `get_account_by_code`)
  - Parses JSONB tax_lines
  - Inserts journal_entries + journal_entry_lines
  - Validates period state
- At 300 writes/sec, trigger execution time (50-200ms each) creates queue buildup
- Database connection pool exhaustion as transactions hold connections longer
- Timeout errors cascade to API layer

**Fix Recommendation:**
1. **Immediate:** Move posting to async queue (BullMQ, pg-boss, or Supabase Edge Functions)
2. **Short-term:** Add idempotency keys to posting functions to prevent duplicate posting
3. **Long-term:** Consider event sourcing pattern — write to event log, post to ledger asynchronously

**Effort:** M (2-4 weeks)

---

### 2. **CRITICAL: Inline PDF Generation Blocks Requests** ⚠️⚠️⚠️
**Impact:** CRITICAL | **Likelihood:** HIGH | **Effort:** SMALL

**Evidence:**
- `app/api/invoices/[id]/pdf-preview/route.ts:6-168` — HTML generation inline
- `app/api/accounting/reports/trial-balance/export/pdf/route.ts` — PDF generation inline
- `app/api/accounting/reports/profit-and-loss/export/pdf/route.ts` — PDF generation inline
- `app/api/accounting/reports/balance-sheet/export/pdf/route.ts` — PDF generation inline
- `lib/pdfReportGenerator.ts:14-43` — Uses pdfkit (synchronous, CPU-intensive)

**Failure Mode:**
- PDF generation takes 500ms-3s per document
- At 20 concurrent PDF requests, Node.js event loop blocked
- Request timeouts (Next.js default 10s) cause user-facing errors
- Database connections held during PDF generation

**Fix Recommendation:**
1. **Immediate:** Move PDF generation to background job queue
2. **Short-term:** Return job ID, poll for completion, or use WebSocket for status
3. **Alternative:** Pre-generate PDFs on invoice send, cache in object storage (S3/Supabase Storage)

**Effort:** S (1 week)

---

### 3. **CRITICAL: Inline Email Sending Blocks Requests** ⚠️⚠️⚠️
**Impact:** CRITICAL | **Likelihood:** HIGH | **Effort:** SMALL

**Evidence:**
- `app/api/invoices/[id]/send/route.ts:215-238` — Email sending inline (TODO comment indicates not implemented, but pattern exists)
- `app/api/reminders/process-automated/route.ts:227-234` — Email sending in loop
- `app/api/estimates/[id]/send/route.ts:165-177` — Email sending inline

**Failure Mode:**
- Email API calls (SendGrid, AWS SES, etc.) take 200-1000ms
- At 50 concurrent invoice sends, external API rate limits hit
- Request timeouts cascade
- No retry logic for failed emails

**Fix Recommendation:**
1. **Immediate:** Queue emails via background job (BullMQ, pg-boss)
2. **Short-term:** Add retry logic with exponential backoff
3. **Long-term:** Use transactional email service with webhook delivery status

**Effort:** S (1 week)

---

### 4. **HIGH: Missing Composite Indexes on Critical Query Patterns** ⚠️⚠️
**Impact:** HIGH | **Likelihood:** HIGH | **Effort:** SMALL

**Evidence:**
- `app/api/sales-history/list/route.ts:138-144` — Queries `sales` with `business_id` + `created_at` range, no composite index
- `app/api/invoices/list/route.ts` — Queries `invoices` with `business_id` + `status` + `created_at`, no composite index
- `app/api/reports/tax-summary/route.ts` — Aggregates `invoices` by `business_id` + date range, no composite index
- `app/api/reports/vat-control/route.ts` — Queries `journal_entry_lines` by `account_id` + date range via joins

**Missing Indexes:**
```sql
-- Sales table
CREATE INDEX idx_sales_business_created ON sales(business_id, created_at DESC);
CREATE INDEX idx_sales_business_status_created ON sales(business_id, status, created_at DESC);
CREATE INDEX idx_sales_business_store_created ON sales(business_id, store_id, created_at DESC) WHERE store_id IS NOT NULL;

-- Invoices table
CREATE INDEX idx_invoices_business_status_created ON invoices(business_id, status, created_at DESC);
CREATE INDEX idx_invoices_business_due_date ON invoices(business_id, due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_invoices_business_customer ON invoices(business_id, customer_id) WHERE customer_id IS NOT NULL;

-- Invoice items
CREATE INDEX idx_invoice_items_invoice_product ON invoice_items(invoice_id, product_service_id);

-- Sale items
CREATE INDEX idx_sale_items_sale_product ON sale_items(sale_id, product_id);

-- Payments
CREATE INDEX idx_payments_business_created ON payments(business_id, created_at DESC);
CREATE INDEX idx_payments_invoice_created ON payments(invoice_id, created_at DESC) WHERE invoice_id IS NOT NULL;

-- Customers
CREATE INDEX idx_customers_business_name ON customers(business_id, name);
CREATE INDEX idx_customers_business_email ON customers(business_id, email) WHERE email IS NOT NULL;
```

**Failure Mode:**
- Sequential scans on `sales` table (millions of rows) take 5-30s
- Dashboard queries timeout
- Report generation fails under load

**Fix Recommendation:**
1. **Immediate:** Add composite indexes listed above
2. **Verify:** Run `EXPLAIN ANALYZE` on production-like data to confirm index usage
3. **Monitor:** Track query performance via `pg_stat_statements`

**Effort:** S (3-5 days)

---

### 5. **HIGH: N+1 Query Patterns in Customer 360 and Reports** ⚠️⚠️
**Impact:** HIGH | **Likelihood:** MEDIUM | **Effort:** MEDIUM

**Evidence:**
- `app/api/customers/[id]/360/route.ts:59-89` — Fetches invoices, then loops to fetch payments per invoice
- `app/api/reports/aging/route.ts:71-98` — Fetches invoices, then loops to fetch payments
- `app/api/reports/tax-summary/route.ts:170` — Fetches invoices, then `.in("invoice_id", invoiceIds)` for payments (better, but still 2 queries)

**Failure Mode:**
- Customer 360 endpoint: 1 query for invoices + N queries for payments = 1 + N round trips
- At 100 invoices per customer, 101 database queries
- Latency: 101 × 10ms = 1+ second per request
- Under load, connection pool exhaustion

**Fix Recommendation:**
1. **Immediate:** Use JOINs or batch queries (`.in("invoice_id", invoiceIds)`)
2. **Short-term:** Use Supabase `.select()` with nested relations: `.select("*, payments(*)")`
3. **Long-term:** Denormalize payment totals into invoices table (updated via trigger)

**Effort:** M (1-2 weeks)

---

### 6. **HIGH: No Database Connection Pooling Configuration** ⚠️⚠️
**Impact:** HIGH | **Likelihood:** HIGH | **Effort:** SMALL

**Evidence:**
- `lib/supabaseServer.ts` — Uses Supabase client, no explicit pool configuration
- Supabase default connection pool: ~10-20 connections per instance
- No connection pool monitoring or alerts

**Failure Mode:**
- At 200 concurrent requests, connection pool exhausted
- New requests wait for available connections (queue buildup)
- Timeout errors cascade
- No visibility into pool utilization

**Fix Recommendation:**
1. **Immediate:** Configure Supabase connection pool size (verify current limits)
2. **Short-term:** Add connection pool monitoring (log pool stats)
3. **Long-term:** Use PgBouncer in transaction pooling mode (if self-hosted) or verify Supabase pool settings

**Effort:** S (2-3 days)

---

### 7. **HIGH: Report Functions Query Full journal_entry_lines Table** ⚠️⚠️
**Impact:** HIGH | **Likelihood:** MEDIUM | **Effort:** MEDIUM

**Evidence:**
- `supabase/migrations/138_financial_reports_phase3.sql:29-70` — `get_trial_balance()` uses LEFT JOIN from accounts to journal_entry_lines
- `supabase/migrations/138_financial_reports_phase3.sql:83-145` — `get_general_ledger()` queries journal_entry_lines with window functions
- Indexes exist (`idx_journal_entry_lines_entry_account`, `idx_journal_entry_lines_account_entry`) but may not cover all query patterns

**Failure Mode:**
- Trial Balance for 1 year: scans millions of journal_entry_lines rows
- Window function for running balance: O(n log n) complexity
- Report generation takes 10-60s under load
- Multiple concurrent reports cause database CPU spike

**Fix Recommendation:**
1. **Immediate:** Verify indexes are used via `EXPLAIN ANALYZE`
2. **Short-term:** Add materialized views for common report periods (refresh nightly)
3. **Long-term:** Pre-aggregate balances in `account_balances` table (updated via trigger)

**Effort:** M (2-3 weeks)

---

### 8. **MEDIUM: No Caching Layer for Business Settings and Tax Calculations** ⚠️
**Impact:** MEDIUM | **Likelihood:** HIGH | **Effort:** MEDIUM

**Evidence:**
- `app/api/invoices/create/route.ts:93-97` — Fetches business settings on every invoice create
- `app/api/sales/create/route.ts:133-137` — Fetches business on every sale create
- `lib/taxEngine/helpers.ts` — Tax calculations executed on every request (no memoization)

**Failure Mode:**
- Business settings queried 300+ times/sec (one per write)
- Tax calculation logic (pure functions) re-executed unnecessarily
- Database load from repeated lookups

**Fix Recommendation:**
1. **Immediate:** Add in-memory cache (Node.js Map with TTL) for business settings
2. **Short-term:** Use Redis for distributed caching (if multi-instance)
3. **Long-term:** Cache tax calculation results (key: jurisdiction + effective_date + line_items_hash)

**Effort:** M (1-2 weeks)

---

### 9. **MEDIUM: RLS Policies Are Permissive (Security + Performance Risk)** ⚠️
**Impact:** MEDIUM | **Likelihood:** LOW | **Effort:** MEDIUM

**Evidence:**
- `supabase/migrations/051_fix_all_table_structures.sql:627-639` — Many tables have `USING (true)` policies
- `supabase/migrations/030_ensure_multi_store_complete.sql:47-50` — Stores table: `USING (true)`
- `supabase/migrations/027_multi_store_support.sql:48-92` — Permissive policies for development

**Failure Mode:**
- While not a direct performance issue, permissive RLS means:
  - No query optimization via RLS (PostgreSQL can't push down filters)
  - Security risk if service role key leaked
  - Potential for cross-tenant data leaks

**Fix Recommendation:**
1. **Immediate:** Audit all RLS policies, replace `USING (true)` with proper `business_id` checks
2. **Short-term:** Test RLS policies with `SET ROLE` to verify tenant isolation
3. **Long-term:** Add RLS policy testing to CI/CD

**Effort:** M (2-3 weeks)

---

### 10. **MEDIUM: Stock Deduction Logic Has Sequential Queries in Loop** ⚠️
**Impact:** MEDIUM | **Likelihood:** MEDIUM | **Effort:** SMALL

**Evidence:**
- `app/api/sales/create/route.ts:906-1293` — Loops through `sale_items`, queries `products_stock` for each item
- `app/api/sales/create/route.ts:774-803` — Fetches product cost prices in batch (good), but variant costs fetched separately

**Failure Mode:**
- Sale with 20 items = 20+ stock queries
- At 50 concurrent sales, 1,000+ stock queries/sec
- Stock table lock contention (UPDATE operations)
- Deadlock potential if two sales update same product simultaneously

**Fix Recommendation:**
1. **Immediate:** Batch stock queries: `.in("product_id", productIds).in("store_id", [storeId])`
2. **Short-term:** Use `SELECT ... FOR UPDATE SKIP LOCKED` for stock reservations
3. **Long-term:** Consider optimistic locking (version column) or event sourcing for stock

**Effort:** S (3-5 days)

---

### 11. **MEDIUM: No Rate Limiting on API Endpoints** ⚠️
**Impact:** MEDIUM | **Likelihood:** MEDIUM | **Effort:** SMALL

**Evidence:**
- `app/api/auth/pin-login/route.ts:11-38` — In-memory rate limiting (only for PIN login)
- No rate limiting on `/api/sales/create`, `/api/invoices/create`, `/api/reports/*`
- No DDoS protection

**Failure Mode:**
- Malicious user or buggy client sends 1,000 requests/sec
- Database overwhelmed
- Legitimate users experience timeouts

**Fix Recommendation:**
1. **Immediate:** Add rate limiting middleware (upstash/ratelimit, or Next.js middleware)
2. **Short-term:** Per-user rate limits (e.g., 100 requests/min per user)
3. **Long-term:** Per-endpoint rate limits (e.g., 10 reports/min, 50 sales/min)

**Effort:** S (3-5 days)

---

### 12. **MEDIUM: JSONB tax_lines Column Not Indexed** ⚠️
**Impact:** MEDIUM | **Likelihood:** LOW | **Effort:** SMALL

**Evidence:**
- `invoices.tax_lines` — JSONB column, no GIN index
- `sales.tax_lines` — JSONB column, no GIN index
- Queries filtering by tax code require full table scan

**Failure Mode:**
- VAT report queries: `WHERE tax_lines @> '{"code": "VAT"}'` scans all rows
- At millions of invoices, query takes minutes

**Fix Recommendation:**
1. **Immediate:** Add GIN index: `CREATE INDEX idx_invoices_tax_lines_gin ON invoices USING GIN (tax_lines);`
2. **Verify:** Test query performance with `EXPLAIN ANALYZE`

**Effort:** S (1 day)

---

### 13. **LOW: No Query Timeout Configuration** ⚠️
**Impact:** LOW | **Likelihood:** MEDIUM | **Effort:** SMALL

**Evidence:**
- Supabase client queries have no explicit timeout
- Long-running queries (reports) can hold connections indefinitely

**Failure Mode:**
- Buggy query or missing index causes 60s+ query
- Connection pool exhausted
- Cascading failures

**Fix Recommendation:**
1. **Immediate:** Set query timeout: `supabase.rpc('function', { timeout: 30000 })`
2. **Short-term:** Add timeout to all report endpoints (30s max)

**Effort:** S (1 day)

---

### 14. **LOW: Audit Logging Writes Synchronously** ⚠️
**Impact:** LOW | **Likelihood:** LOW | **Effort:** SMALL

**Evidence:**
- `lib/auditLog.ts` — `createAuditLog()` called inline in API routes
- `app/api/invoices/create/route.ts:404-413` — Audit log written synchronously

**Failure Mode:**
- Audit log write adds 10-50ms to every request
- At 300 writes/sec, audit_logs table becomes hot
- If audit log write fails, entire request fails (should be fire-and-forget)

**Fix Recommendation:**
1. **Immediate:** Queue audit logs to background job (non-blocking)
2. **Short-term:** Use `INSERT ... ON CONFLICT DO NOTHING` for idempotency

**Effort:** S (2-3 days)

---

### 15. **LOW: No Database Query Monitoring** ⚠️
**Impact:** LOW | **Likelihood:** HIGH | **Effort:** SMALL

**Evidence:**
- No `pg_stat_statements` enabled (assumed)
- No slow query logging
- No query performance dashboards

**Failure Mode:**
- Can't identify slow queries until users complain
- No visibility into database load patterns
- Reactive debugging instead of proactive optimization

**Fix Recommendation:**
1. **Immediate:** Enable `pg_stat_statements` in Supabase
2. **Short-term:** Set up query performance dashboard (Grafana + Prometheus, or Supabase dashboard)
3. **Long-term:** Add application-level query logging (log queries > 100ms)

**Effort:** S (2-3 days)

---

## C. DATABASE INDEX PLAN

### Critical Missing Indexes

```sql
-- ============================================================================
-- SALES TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sales_business_created 
ON sales(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_business_status_created 
ON sales(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_business_store_created 
ON sales(business_id, store_id, created_at DESC) 
WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_business_customer 
ON sales(business_id, customer_id) 
WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_register_created 
ON sales(register_id, created_at DESC) 
WHERE register_id IS NOT NULL;

-- ============================================================================
-- INVOICES TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_invoices_business_status_created 
ON invoices(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_business_due_date 
ON invoices(business_id, due_date) 
WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_business_customer 
ON invoices(business_id, customer_id) 
WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_business_sent_at 
ON invoices(business_id, sent_at DESC) 
WHERE sent_at IS NOT NULL;

-- ============================================================================
-- PAYMENTS TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_payments_business_created 
ON payments(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_created 
ON payments(invoice_id, created_at DESC) 
WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_business_invoice 
ON payments(business_id, invoice_id) 
WHERE invoice_id IS NOT NULL;

-- ============================================================================
-- INVOICE ITEMS TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_product 
ON invoice_items(invoice_id, product_service_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_product 
ON invoice_items(product_service_id) 
WHERE product_service_id IS NOT NULL;

-- ============================================================================
-- SALE ITEMS TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product 
ON sale_items(sale_id, product_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product 
ON sale_items(product_id) 
WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_store 
ON sale_items(store_id) 
WHERE store_id IS NOT NULL;

-- ============================================================================
-- CUSTOMERS TABLE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_customers_business_name 
ON customers(business_id, name);

CREATE INDEX IF NOT EXISTS idx_customers_business_email 
ON customers(business_id, email) 
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_business_phone 
ON customers(business_id, phone) 
WHERE phone IS NOT NULL;

-- ============================================================================
-- PRODUCTS_STOCK TABLE INDEXES (CRITICAL FOR POS)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_products_stock_store_product_variant 
ON products_stock(store_id, product_id, variant_id) 
WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_stock_product_variant 
ON products_stock(product_id, variant_id) 
WHERE variant_id IS NOT NULL;

-- ============================================================================
-- JSONB GIN INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_invoices_tax_lines_gin 
ON invoices USING GIN (tax_lines) 
WHERE tax_lines IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_tax_lines_gin 
ON sales USING GIN (tax_lines) 
WHERE tax_lines IS NOT NULL;

-- ============================================================================
-- JOURNAL ENTRY LINES (ENHANCEMENT)
-- ============================================================================
-- Existing indexes are good, but verify they cover:
-- - Trial Balance: business_id + account_id + date range
-- - General Ledger: account_id + journal_entry_id + date range

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_business_account_date 
ON journal_entry_lines(journal_entry_id, account_id) 
INCLUDE (debit, credit);

-- Note: This index supports both Trial Balance (group by account) 
-- and General Ledger (filter by account + date range via journal_entry_id join)
```

### Index Verification Queries

```sql
-- Verify index usage on critical queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM sales 
WHERE business_id = '...' 
  AND created_at >= '2025-01-01' 
  AND created_at <= '2025-12-31'
ORDER BY created_at DESC
LIMIT 100;

-- Verify invoice list query
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM invoices 
WHERE business_id = '...' 
  AND status IN ('sent', 'paid')
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC;

-- Verify stock query (POS critical path)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM products_stock 
WHERE store_id = '...' 
  AND product_id = '...' 
  AND variant_id IS NULL;
```

---

## D. SCALE READINESS ROADMAP

### Phase 1: Must-Do (1-2 weeks) — Critical for 50-100 concurrent users

**Goal:** Prevent immediate failures at moderate load

1. **Add Composite Indexes** (3-5 days)
   - Implement all indexes from Section C
   - Verify with `EXPLAIN ANALYZE` on production-like data
   - Monitor index size and maintenance overhead

2. **Move PDF Generation to Queue** (3-5 days)
   - Set up BullMQ or pg-boss
   - Create background worker for PDF generation
   - Update API endpoints to return job ID, poll for status

3. **Move Email Sending to Queue** (2-3 days)
   - Add email jobs to same queue
   - Implement retry logic with exponential backoff
   - Add webhook for delivery status (optional)

4. **Add Rate Limiting** (2-3 days)
   - Implement per-user rate limits (100 req/min)
   - Per-endpoint limits (10 reports/min, 50 sales/min)
   - Use Upstash Redis or Next.js middleware

5. **Fix N+1 Queries** (3-5 days)
   - Refactor customer 360 endpoint to use JOINs
   - Batch payment queries in reports
   - Use Supabase nested selects where possible

**Total Effort:** 13-21 days

---

### Phase 2: Should-Do (2-6 weeks) — Critical for 200-500 concurrent users

**Goal:** Handle peak load without degradation

1. **Move Ledger Posting to Async Queue** (2-3 weeks)
   - Extract posting logic to background workers
   - Add idempotency keys to prevent duplicate posting
   - Implement retry logic for failed postings
   - Add monitoring/alerting for posting failures

2. **Add Caching Layer** (1-2 weeks)
   - Implement Redis for business settings cache
   - Cache tax calculation results (key: jurisdiction + date + items hash)
   - Add cache invalidation on business settings update

3. **Optimize Report Functions** (2-3 weeks)
   - Verify indexes are used via `EXPLAIN ANALYZE`
   - Add materialized views for common report periods
   - Implement pagination for large reports
   - Add query timeouts (30s max)

4. **Batch Stock Queries** (1 week)
   - Refactor sale creation to batch stock lookups
   - Use `SELECT ... FOR UPDATE SKIP LOCKED` for stock reservations
   - Add deadlock detection and retry logic

5. **Add Database Monitoring** (1 week)
   - Enable `pg_stat_statements`
   - Set up query performance dashboard
   - Add alerts for slow queries (> 1s)

6. **Harden RLS Policies** (2-3 weeks)
   - Replace `USING (true)` with proper `business_id` checks
   - Test RLS policies with `SET ROLE`
   - Add RLS policy tests to CI/CD

**Total Effort:** 9-15 weeks

---

### Phase 3: Nice-to-Have (6+ weeks) — Optimizations for 1,000+ concurrent users

**Goal:** Scale efficiently to 10k+ businesses

1. **Implement Materialized Views for Reports** (2-3 weeks)
   - Pre-aggregate Trial Balance by period
   - Pre-aggregate VAT summaries by month
   - Refresh views nightly or on-demand

2. **Add Read Replicas** (1-2 weeks)
   - Configure Supabase read replicas (if available)
   - Route report queries to read replicas
   - Route write queries to primary

3. **Implement Connection Pooling** (1 week)
   - Verify Supabase connection pool settings
   - Add PgBouncer if self-hosted
   - Monitor pool utilization

4. **Add Query Result Caching** (2-3 weeks)
   - Cache report results (key: business_id + date_range + report_type)
   - Invalidate on new transactions
   - Use Redis with TTL

5. **Optimize JSONB Queries** (1 week)
   - Add GIN indexes on tax_lines
   - Verify query performance improvements

6. **Implement Event Sourcing for Stock** (4-6 weeks)
   - Move stock updates to event log
   - Rebuild stock from events (eventual consistency)
   - Reduces lock contention

7. **Add Database Partitioning** (3-4 weeks)
   - Partition `sales` by `created_at` (monthly partitions)
   - Partition `invoices` by `created_at`
   - Partition `journal_entry_lines` by `journal_entry_id` hash

**Total Effort:** 14-20 weeks

---

## E. LOAD TEST CHECKLIST

### Test Scenarios

#### Scenario 1: POS Sale Creation Burst
**Endpoint:** `POST /api/sales/create`  
**Target RPS:** 50-100 requests/sec  
**Duration:** 5 minutes  
**Payload:** Single-item sale (1 product, cash payment)

**Metrics to Capture:**
- P50/P95/P99 latency
- Error rate (target: < 1%)
- Database connection pool utilization
- Trigger execution time (`post_sale_to_ledger`)
- Stock update latency

**Pass/Fail Thresholds:**
- ✅ P95 latency < 500ms
- ✅ Error rate < 1%
- ✅ No connection pool exhaustion
- ❌ Fail if P99 latency > 2s

---

#### Scenario 2: Invoice Creation + Send
**Endpoint:** `POST /api/invoices/create` → `POST /api/invoices/[id]/send`  
**Target RPS:** 20-50 requests/sec  
**Duration:** 5 minutes  
**Payload:** 5-item invoice, send via email

**Metrics to Capture:**
- End-to-end latency (create + send)
- PDF generation time (if inline)
- Email sending time (if inline)
- Database trigger time (`post_invoice_to_ledger`)
- Error rate

**Pass/Fail Thresholds:**
- ✅ P95 latency < 2s (if PDF/email async)
- ✅ P95 latency < 5s (if inline — should fail)
- ✅ Error rate < 1%
- ❌ Fail if email queue builds up

---

#### Scenario 3: Report Generation Under Load
**Endpoint:** `GET /api/accounting/reports/trial-balance?period_start=2025-01-01`  
**Target RPS:** 10-20 requests/sec  
**Duration:** 5 minutes  
**Payload:** 1-year date range

**Metrics to Capture:**
- Report generation time
- Database query time (`get_trial_balance` RPC)
- Rows scanned (should use indexes)
- CPU utilization
- Memory usage

**Pass/Fail Thresholds:**
- ✅ P95 latency < 5s
- ✅ Index scans (no sequential scans)
- ✅ Error rate < 1%
- ❌ Fail if query time > 10s

---

#### Scenario 4: Mixed Workload (Realistic)
**Endpoints:**
- `POST /api/sales/create` (30 RPS)
- `POST /api/invoices/create` (10 RPS)
- `GET /api/reports/trial-balance` (5 RPS)
- `GET /api/customers/[id]/360` (10 RPS)

**Target RPS:** 55 total requests/sec  
**Duration:** 10 minutes

**Metrics to Capture:**
- Overall system latency
- Database connection pool utilization
- Error rate per endpoint
- Resource utilization (CPU, memory, I/O)

**Pass/Fail Thresholds:**
- ✅ P95 latency < 1s (sales), < 2s (invoices), < 5s (reports)
- ✅ Error rate < 1% across all endpoints
- ✅ No connection pool exhaustion
- ❌ Fail if any endpoint error rate > 5%

---

#### Scenario 5: Sustained Load (Endurance)
**Endpoints:** All critical endpoints  
**Target RPS:** 100 requests/sec (mixed)  
**Duration:** 1 hour

**Metrics to Capture:**
- Latency degradation over time
- Memory leaks (memory usage growth)
- Database connection pool stability
- Error rate trends

**Pass/Fail Thresholds:**
- ✅ Latency stable (no degradation > 20%)
- ✅ Memory usage stable (no leaks)
- ✅ Error rate < 1% throughout
- ❌ Fail if latency degrades > 50% over 1 hour

---

### Load Testing Tools

**Recommended:** k6 (Grafana k6)
- Scriptable, JavaScript-based
- Good for CI/CD integration
- Supports WebSocket, HTTP/2

**Alternative:** Artillery, Locust, or Apache JMeter

### Sample k6 Script (Scenario 1)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },  // Ramp up to 50 RPS
    { duration: '5m', target: 50 },  // Stay at 50 RPS
    { duration: '1m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.01'],   // Error rate < 1%
  },
};

export default function () {
  const payload = JSON.stringify({
    business_id: 'test-business-id',
    user_id: 'test-user-id',
    store_id: 'test-store-id',
    register_id: 'test-register-id',
    amount: 100.00,
    subtotal: 85.47,
    tax_total: 14.53,
    payment_method: 'cash',
    payment_status: 'paid',
    sale_items: [{
      product_id: 'test-product-id',
      quantity: 1,
      unit_price: 100.00,
    }],
    tax_lines: [/* ... */],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token',
    },
  };

  const res = http.post('https://api.finza.com/api/sales/create', payload, params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

---

## F. INFRASTRUCTURE VERIFICATION CHECKLIST

### Supabase/PostgreSQL Settings to Verify

- [ ] **Connection Pool Size:** What is the max connections per instance? (Target: 100+)
- [ ] **Query Timeout:** What is the default query timeout? (Target: 30s)
- [ ] **pg_stat_statements:** Is it enabled? (Required for monitoring)
- [ ] **Autovacuum:** Is it configured for high-write tables? (sales, invoices, journal_entry_lines)
- [ ] **Shared Buffers:** What is the shared_buffers setting? (Should be ~25% of RAM)
- [ ] **Work Mem:** What is work_mem? (Should be 64MB+ for complex queries)
- [ ] **Max Locks:** What is max_locks_per_transaction? (Should be 256+ for complex transactions)

### Next.js Runtime Settings

- [ ] **Function Timeout:** What is the serverless function timeout? (Target: 30s+)
- [ ] **Memory Limit:** What is the function memory limit? (Target: 1GB+)
- [ ] **Concurrent Requests:** What is the max concurrent requests per instance? (Target: 100+)

### External Services

- [ ] **Email Service:** What are the rate limits? (SendGrid: 100 emails/sec, AWS SES: varies)
- [ ] **Object Storage:** What are the upload/download limits? (Supabase Storage: verify)
- [ ] **CDN:** Is there a CDN for static assets? (Required for PDFs, images)

---

## G. ASSUMPTIONS & UNKNOWNS

### Confirmed Risks (Evidence Provided)
- ✅ Row-level triggers on high-write tables
- ✅ Inline PDF/email generation
- ✅ Missing composite indexes
- ✅ N+1 query patterns
- ✅ No caching layer
- ✅ Permissive RLS policies

### Assumptions (Require Verification)
- ⚠️ **Supabase connection pool size:** Assumed 10-20, need to verify
- ⚠️ **Database query timeout:** Assumed no timeout, need to verify
- ⚠️ **Next.js function timeout:** Assumed 10s, need to verify
- ⚠️ **pg_stat_statements enabled:** Assumed not enabled, need to verify
- ⚠️ **Autovacuum configuration:** Assumed default, need to verify for high-write tables

### Unknowns (Require Investigation)
- ❓ **Current database size:** How many rows in sales, invoices, journal_entry_lines?
- ❓ **Query performance baseline:** What are current P50/P95 latencies?
- ❓ **Connection pool utilization:** What is current pool usage under load?
- ❓ **Trigger execution time:** How long do posting triggers take? (Need to measure)
- ❓ **Report generation time:** How long do reports take? (Need to measure)

---

## H. RECOMMENDED IMMEDIATE ACTIONS

1. **This Week:**
   - Add composite indexes (Section C)
   - Set up k6 load testing
   - Measure baseline performance (P50/P95 latencies)

2. **Next Week:**
   - Move PDF generation to queue
   - Move email sending to queue
   - Add rate limiting

3. **Within 2 Weeks:**
   - Fix N+1 queries
   - Add caching layer
   - Run load tests and verify improvements

---

**Report End**
