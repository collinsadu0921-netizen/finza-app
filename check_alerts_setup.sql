-- Diagnostic queries to check alerts table setup
-- Run these in Supabase SQL Editor

-- ============================================================================
-- 1. Check if internal_alerts table exists
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'internal_alerts'
    ) 
    THEN '✓ Table exists' 
    ELSE '✗ Table does NOT exist - Run migration 081_add_partial_payment_alerts.sql'
  END as table_status;

-- ============================================================================
-- 2. Check table structure
-- ============================================================================
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'internal_alerts'
ORDER BY ordinal_position;

-- ============================================================================
-- 3. Count alerts in table (all businesses)
-- ============================================================================
SELECT 
  COUNT(*) as total_alerts,
  COUNT(*) FILTER (WHERE is_read = false) as unread_alerts,
  COUNT(*) FILTER (WHERE is_read = true) as read_alerts,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_alerts
FROM internal_alerts;

-- ============================================================================
-- 4. Check if trigger exists
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'trigger_partial_payment_alert'
    ) 
    THEN '✓ Trigger exists' 
    ELSE '✗ Trigger does NOT exist'
  END as trigger_status;

-- ============================================================================
-- 5. Check if function exists
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname = 'create_partial_payment_alert'
    ) 
    THEN '✓ Function exists' 
    ELSE '✗ Function does NOT exist'
  END as function_status;

-- ============================================================================
-- 6. Check recent payments that should have created alerts
-- ============================================================================
-- Find invoices with partial payments (outstanding > 0)
WITH invoice_totals AS (
  SELECT 
    i.id as invoice_id,
    i.business_id,
    i.invoice_number,
    i.total as invoice_total,
    COALESCE(SUM(p.amount), 0) as total_paid,
    COALESCE(SUM(cn.total) FILTER (WHERE cn.status = 'applied'), 0) as total_credits
  FROM invoices i
  LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
  LEFT JOIN credit_notes cn ON cn.invoice_id = i.id AND cn.deleted_at IS NULL
  WHERE i.deleted_at IS NULL
  GROUP BY i.id, i.business_id, i.invoice_number, i.total
)
SELECT 
  it.invoice_id,
  it.invoice_number,
  it.invoice_total,
  it.total_paid,
  it.total_credits,
  (it.invoice_total - it.total_paid - it.total_credits) as outstanding_amount,
  CASE 
    WHEN (it.invoice_total - it.total_paid - it.total_credits) > 0 
    THEN 'Should have alert'
    ELSE 'Fully paid'
  END as alert_status
FROM invoice_totals it
WHERE (it.invoice_total - it.total_paid - it.total_credits) > 0
ORDER BY it.invoice_id DESC
LIMIT 10;

-- ============================================================================
-- 7. Check recent payments without alerts
-- ============================================================================
SELECT 
  p.id as payment_id,
  p.invoice_id,
  i.invoice_number,
  p.amount as payment_amount,
  CASE 
    WHEN a.id IS NOT NULL THEN 'Has alert'
    ELSE 'Missing alert'
  END as alert_status
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN internal_alerts a ON a.payment_id = p.id AND a.alert_type = 'partial_payment'
WHERE p.deleted_at IS NULL
  AND i.deleted_at IS NULL
ORDER BY p.created_at DESC
LIMIT 10;

-- ============================================================================
-- 8. View all alerts (if any exist)
-- ============================================================================
SELECT 
  id,
  business_id,
  alert_type,
  title,
  message,
  is_read,
  created_at,
  invoice_id,
  payment_id
FROM internal_alerts
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;













