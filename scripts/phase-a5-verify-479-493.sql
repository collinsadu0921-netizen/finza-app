-- Phase A.5 verify-only SQL for production migrations 479-493
-- Run this in Supabase SQL Editor on production: qjxhibvbmzogyzbhswjj
-- No writes. Read-only verification only.

-- 1. Functions used by 483-488, 489-490, 492
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ensure_accounting_initialized_system',
    'repair_orphan_invoice_payment_journals',
    'trigger_post_payment',
    'resolve_default_accounting_period',
    'get_balance_sheet_as_of',
    'get_cumulative_net_income_as_of',
    'finza_business_can_write_service_records',
    'finza_business_has_service_min_tier',
    'finza_service_trial_rls_can_write',
    'get_profit_and_loss_movement',
    'post_invoice_to_ledger'
  )
order by 1;

-- 2. 482 index
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'payments_reference_hubtel_fzhb_unique';

-- 3. 491 policy
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('invoices', 'invoice_items')
  and policyname = 'service trial read select'
order by tablename, policyname;

-- 4. Numeric history 479-493
select version, name, inserted_at
from supabase_migrations.schema_migrations
where version ~ '^[0-9]+$'
  and version::bigint between 479 and 493
order by version::bigint;

-- 5. Missing expected versions 479-493
with expected(version) as (
  select generate_series(479, 493)::text
),
applied as (
  select version::text
  from supabase_migrations.schema_migrations
  where version ~ '^[0-9]+$'
)
select e.version as missing_version
from expected e
left join applied a on a.version = e.version
where a.version is null
order by e.version::bigint;
