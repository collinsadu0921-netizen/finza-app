-- Production migration preflight — Finza Pro (qjxhibvbmzogyzbhswjj)
-- READ ONLY. Run in Supabase SQL Editor. Do not apply migrations from this file.

-- Step 1: Migration history (numeric)
select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version::bigint desc nulls last, inserted_at desc;

-- Step 1b: Non-numeric migration versions
select version, name, inserted_at
from supabase_migrations.schema_migrations
where version !~ '^[0-9]+$'
order by inserted_at desc;

-- Step 1c: 463–478 history rows
select version, name, inserted_at
from supabase_migrations.schema_migrations
where version::text between '463' and '478'
   or name ilike '%463%' or name ilike '%478%'
order by version::bigint nulls last, inserted_at desc;

-- Step 1d: Full catch-up window 463–521 (numeric versions only)
select version, name, inserted_at
from supabase_migrations.schema_migrations
where version ~ '^[0-9]+$'
  and version::bigint between 463 and 521
order by version::bigint;

-- Step 1e: Missing numeric versions in 494–521 (expected apply candidates)
with expected(version) as (
  select unnest(array[
    494,495,496,497,498,499,500,501,502,503,506,507,508,509,510,511,512,513,514,515,516,517,518,519,520,521
  ]::bigint[])
),
applied as (
  select version::bigint as version
  from supabase_migrations.schema_migrations
  where version ~ '^[0-9]+$'
    and version::bigint between 494 and 521
)
select e.version as missing_version
from expected e
left join applied a using (version)
where a.version is null
order by e.version;

-- Step 2: 463–478 fingerprint tables
select to_regclass('public.salary_advance_repayments') is not null as has_salary_advance_repayments,
       to_regclass('public.payroll_obligations') is not null as has_payroll_obligations,
       to_regclass('public.staff_payment_methods') is not null as has_staff_payment_methods,
       to_regclass('public.payroll_payment_batches') is not null as has_payroll_payment_batches;

-- Step 2b: Staff tax profile columns (477)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'staff'
  and column_name in (
    'is_tax_resident',
    'is_pensionable',
    'gra_position_code',
    'secondary_employment'
  )
order by column_name;

-- Step 2c: Payroll filing snapshots (478)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payroll_entries'
  and column_name in (
    'payroll_tax_profile',
    'filing_tin',
    'filing_employee_name',
    'bonus_concessional_amount',
    'bonus_graduated_amount'
  )
order by column_name;

-- Step 3: Proforma 520 duplicate risk (must return zero rows)
select business_id, proforma_number, count(*)
from proforma_invoices
where proforma_number is not null
  and deleted_at is null
group by business_id, proforma_number
having count(*) > 1;

-- Step 4: Payroll 521 columns (expected zero rows before apply)
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payroll_entries'
  and column_name in (
    'is_included',
    'base_salary_snapshot',
    'adjustment_amount',
    'adjustment_reason',
    'exclusion_reason'
  )
order by column_name;

-- Step 5: Materials 517–519
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'service_material_inventory'
  and column_name in (
    'is_billable',
    'default_cost_price',
    'default_selling_price',
    'sales_name',
    'sales_description'
  )
order by column_name;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'invoice_items' and column_name = 'material_id')
    or (table_name = 'estimate_items' and column_name = 'material_id')
    or (table_name = 'proforma_invoice_items' and column_name = 'material_id')
  )
order by table_name;

-- Step 6: Dashboard/support objects
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_cash_collected_total',
    'get_operational_overdue_invoices_page',
    'get_service_dashboard_timeline',
    'get_service_dashboard_metrics',
    'get_bills_list_page',
    'get_operational_unpaid_invoices_total',
    'refresh_service_dashboard_period_summaries'
  )
order by proname;

select to_regclass('public.support_requests') is not null as has_support_requests,
       to_regclass('public.service_dashboard_period_summary') is not null as has_period_summary;
