-- Phase B2 post-apply verification (read-only)
select to_regclass('public.service_dashboard_period_summary') is not null as has_service_dashboard_period_summary;

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'refresh_service_dashboard_period_summaries',
    'get_bills_list_page',
    'get_operational_unpaid_invoices_total',
    'get_service_dashboard_metrics',
    'get_service_dashboard_timeline'
  )
order by p.proname;

select to_regclass('public.service_pnl_movement_lines') is not null as has_service_pnl_movement_lines;

select to_regclass('public.support_requests') is not null as has_support_requests;

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
order by table_name, column_name;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'proforma_invoices'
  and column_name in ('revision_number', 'supersedes_id')
order by column_name;

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

select version, name
from supabase_migrations.schema_migrations
where version ~ '^[0-9]+$'
  and version::bigint between 507 and 521
order by version::bigint;
