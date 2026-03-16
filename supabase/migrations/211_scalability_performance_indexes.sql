-- ============================================================================
-- MIGRATION: Scalability Performance Indexes
-- ============================================================================
-- Adds critical composite indexes identified in scalability audit
-- 
-- Purpose: Optimize query performance for high-concurrency scenarios
-- Target Scale: 10k+ businesses, 100k+ users, 500-2,000 concurrent sessions
-- 
-- These indexes address:
-- - Sequential scans on sales/invoices tables with business_id + date filters
-- - Missing composite indexes for common query patterns
-- - JSONB tax_lines queries without GIN indexes
-- - Stock lookup performance in POS (critical path)
-- 
-- Scope: Index creation only (no data changes, no application code changes)
-- ============================================================================

-- ============================================================================
-- SALES TABLE INDEXES
-- ============================================================================
-- Optimizes: Sales history queries, dashboard queries, date range filters

CREATE INDEX IF NOT EXISTS idx_sales_business_created 
ON sales(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_business_payment_status_created 
ON sales(business_id, payment_status, created_at DESC);

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
-- Optimizes: Invoice list queries, aging reports, customer statements

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
-- Optimizes: Payment history, invoice payment lookups, reconciliation

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
-- Optimizes: Invoice detail queries, product sales reports

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_product 
ON invoice_items(invoice_id, product_service_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_product 
ON invoice_items(product_service_id) 
WHERE product_service_id IS NOT NULL;

-- ============================================================================
-- SALE ITEMS TABLE INDEXES
-- ============================================================================
-- Optimizes: Sale detail queries, product sales reports, POS analytics

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product 
ON sale_items(sale_id, product_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product 
ON sale_items(product_id) 
WHERE product_id IS NOT NULL;

-- Note: sale_items has no store_id column; store is derived via sale_id -> sales.store_id

-- ============================================================================
-- CUSTOMERS TABLE INDEXES
-- ============================================================================
-- Optimizes: Customer search, customer list queries, duplicate detection

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
-- Optimizes: Stock lookups during sale creation (critical path)
-- These indexes are essential for POS performance at scale

CREATE INDEX IF NOT EXISTS idx_products_stock_store_product_variant 
ON products_stock(store_id, product_id, variant_id) 
WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_stock_product_variant 
ON products_stock(product_id, variant_id) 
WHERE variant_id IS NOT NULL;

-- ============================================================================
-- JSONB GIN INDEXES
-- ============================================================================
-- Optimizes: VAT report queries filtering by tax_lines JSONB
-- Enables efficient queries like: WHERE tax_lines @> '{"code": "VAT"}'

CREATE INDEX IF NOT EXISTS idx_invoices_tax_lines_gin 
ON invoices USING GIN (tax_lines) 
WHERE tax_lines IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_tax_lines_gin 
ON sales USING GIN (tax_lines) 
WHERE tax_lines IS NOT NULL;

-- ============================================================================
-- JOURNAL ENTRY LINES (ENHANCEMENT)
-- ============================================================================
-- Optimizes: Trial Balance and General Ledger report queries
-- Includes debit/credit in index to avoid table lookups (covering index)

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_business_account_date 
ON journal_entry_lines(journal_entry_id, account_id) 
INCLUDE (debit, credit);

-- Note: This index supports both Trial Balance (group by account) 
-- and General Ledger (filter by account + date range via journal_entry_id join)
-- The INCLUDE clause stores debit/credit values in the index to avoid table lookups

-- ============================================================================
-- VERIFY INDEX CREATION
-- ============================================================================

DO $$
DECLARE
  index_count INTEGER;
  expected_count INTEGER := 24; -- Total number of indexes created above
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_sales_business_created',
      'idx_sales_business_payment_status_created',
      'idx_sales_business_store_created',
      'idx_sales_business_customer',
      'idx_sales_register_created',
      'idx_invoices_business_status_created',
      'idx_invoices_business_due_date',
      'idx_invoices_business_customer',
      'idx_invoices_business_sent_at',
      'idx_payments_business_created',
      'idx_payments_invoice_created',
      'idx_payments_business_invoice',
      'idx_invoice_items_invoice_product',
      'idx_invoice_items_product',
      'idx_sale_items_sale_product',
      'idx_sale_items_product',
      'idx_customers_business_name',
      'idx_customers_business_email',
      'idx_customers_business_phone',
      'idx_products_stock_store_product_variant',
      'idx_products_stock_product_variant',
      'idx_invoices_tax_lines_gin',
      'idx_sales_tax_lines_gin',
      'idx_journal_entry_lines_business_account_date'
    );

  IF index_count < expected_count THEN
    RAISE NOTICE 'Warning: Expected at least % indexes, found %', expected_count, index_count;
  ELSE
    RAISE NOTICE 'Successfully created % scalability performance indexes', index_count;
  END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON INDEX idx_sales_business_created IS 'Optimizes sales history queries with business_id + date range filters. Critical for dashboard and sales history endpoints.';
COMMENT ON INDEX idx_sales_business_payment_status_created IS 'Optimizes sales queries filtered by payment_status and date. Used in sales history and analytics.';
COMMENT ON INDEX idx_sales_business_store_created IS 'Optimizes multi-store sales queries. Critical for store-specific reports and analytics.';
COMMENT ON INDEX idx_sales_business_customer IS 'Optimizes customer sales history queries. Used in customer 360 and statement endpoints.';
COMMENT ON INDEX idx_sales_register_created IS 'Optimizes register-specific sales queries. Used in cash office and register reports.';

COMMENT ON INDEX idx_invoices_business_status_created IS 'Optimizes invoice list queries filtered by status and date. Critical for invoice management pages.';
COMMENT ON INDEX idx_invoices_business_due_date IS 'Optimizes aging reports and overdue invoice queries. Used in accounts receivable reports.';
COMMENT ON INDEX idx_invoices_business_customer IS 'Optimizes customer invoice queries. Used in customer statements and 360 views.';
COMMENT ON INDEX idx_invoices_business_sent_at IS 'Optimizes queries for sent invoices. Used in invoice tracking and reporting.';

COMMENT ON INDEX idx_payments_business_created IS 'Optimizes payment history queries. Used in payment reports and reconciliation.';
COMMENT ON INDEX idx_payments_invoice_created IS 'Optimizes invoice payment lookups. Critical for invoice detail pages and payment tracking.';
COMMENT ON INDEX idx_payments_business_invoice IS 'Optimizes business-level payment queries filtered by invoice. Used in reconciliation.';

COMMENT ON INDEX idx_invoice_items_invoice_product IS 'Optimizes invoice detail queries and product sales reports. Supports efficient joins.';
COMMENT ON INDEX idx_invoice_items_product IS 'Optimizes product sales queries across invoices. Used in product performance reports.';

COMMENT ON INDEX idx_sale_items_sale_product IS 'Optimizes sale detail queries and product sales reports. Supports efficient joins.';
COMMENT ON INDEX idx_sale_items_product IS 'Optimizes product sales queries across sales. Used in POS analytics and product reports.';

COMMENT ON INDEX idx_customers_business_name IS 'Optimizes customer search and list queries by name. Critical for customer management.';
COMMENT ON INDEX idx_customers_business_email IS 'Optimizes customer lookup by email. Used in duplicate detection and customer search.';
COMMENT ON INDEX idx_customers_business_phone IS 'Optimizes customer lookup by phone. Used in duplicate detection and customer search.';

COMMENT ON INDEX idx_products_stock_store_product_variant IS 'CRITICAL: Optimizes stock lookups during POS sale creation. This is the hottest query path in the system.';
COMMENT ON INDEX idx_products_stock_product_variant IS 'Optimizes stock queries for variants. Used in inventory management and stock transfers.';

COMMENT ON INDEX idx_invoices_tax_lines_gin IS 'Optimizes VAT report queries filtering by tax_lines JSONB. Enables efficient JSONB containment queries.';
COMMENT ON INDEX idx_sales_tax_lines_gin IS 'Optimizes tax summary queries filtering by tax_lines JSONB. Enables efficient JSONB containment queries.';

COMMENT ON INDEX idx_journal_entry_lines_business_account_date IS 'Optimizes Trial Balance and General Ledger report queries. Covering index includes debit/credit to avoid table lookups.';
