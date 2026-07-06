-- Prime production dashboard period summary (Finza Pro: qjxhibvbmzogyzbhswjj)
-- Run in Supabase SQL Editor as postgres (admin). Read-only checks first.
-- Does NOT use refresh_service_dashboard_period_summaries (requires auth.uid()).
-- Inlines the same upsert logic without the access gate.

-- ── Pilot business (highest activity from prod scan) ───────────────────────
-- Replace if your DevTools business_id differs:
--   2d67cb58-7145-45fe-b940-806a6cf5e2be  (HVAC MASTER TECHNOLOGIES)

-- Step 2: source + summary counts
select count(*) as invoice_count
from invoices
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid
  and deleted_at is null;

select count(*) as payment_count
from payments
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid;

select count(*) as expense_count
from expenses
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid
  and deleted_at is null;

select count(*) as existing_summary_rows
from service_dashboard_period_summary
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid;

-- Step 3: prime ONE business (12 periods max)
do $$
declare
  v_business_id uuid := '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid;
  v_limit int := 12;
  v_count int := 0;
  r record;
  v_rev numeric;
  v_exp numeric;
  v_np numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text, 50701));

  for r in
    select ap.id, ap.period_start, ap.period_end
    from accounting_periods ap
    where ap.business_id = v_business_id
    order by ap.period_start desc
    limit v_limit
  loop
    select p.revenue, p.expenses, p.net_profit
    into v_rev, v_exp, v_np
    from finza_dashboard_pnl_totals(v_business_id, r.period_start, r.period_end) p;

    insert into public.service_dashboard_period_summary (
      business_id, period_id, period_start, period_end,
      revenue, expenses, net_profit, refreshed_at
    )
    values (
      v_business_id, r.id, r.period_start, r.period_end,
      coalesce(v_rev, 0), coalesce(v_exp, 0), coalesce(v_np, 0), now()
    )
    on conflict (business_id, period_id) do update set
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      revenue = excluded.revenue,
      expenses = excluded.expenses,
      net_profit = excluded.net_profit,
      refreshed_at = now();

    v_count := v_count + 1;
  end loop;

  raise notice 'primed % summary rows for business %', v_count, v_business_id;
end $$;

-- Verify pilot
select count(*) as summary_rows
from service_dashboard_period_summary
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid;

select period_start, period_end, revenue, expenses, net_profit, refreshed_at
from service_dashboard_period_summary
where business_id = '2d67cb58-7145-45fe-b940-806a6cf5e2be'::uuid
order by period_start desc
limit 12;

-- Step 5: AFTER pilot chart works in app — prime all businesses with activity
-- (uncomment and run separately)

/*
do $$
declare
  b record;
  v_limit int := 12;
  v_count int;
  r record;
  v_rev numeric;
  v_exp numeric;
  v_np numeric;
begin
  for b in
    select distinct business_id
    from (
      select business_id from invoices where deleted_at is null
      union
      select business_id from expenses where deleted_at is null
      union
      select business_id from payments
    ) x
    where business_id is not null
  loop
    v_count := 0;
    perform pg_advisory_xact_lock(hashtextextended(b.business_id::text, 50701));

    for r in
      select ap.id, ap.period_start, ap.period_end
      from accounting_periods ap
      where ap.business_id = b.business_id
      order by ap.period_start desc
      limit v_limit
    loop
      select p.revenue, p.expenses, p.net_profit
      into v_rev, v_exp, v_np
      from finza_dashboard_pnl_totals(b.business_id, r.period_start, r.period_end) p;

      insert into public.service_dashboard_period_summary (
        business_id, period_id, period_start, period_end,
        revenue, expenses, net_profit, refreshed_at
      )
      values (
        b.business_id, r.id, r.period_start, r.period_end,
        coalesce(v_rev, 0), coalesce(v_exp, 0), coalesce(v_np, 0), now()
      )
      on conflict (business_id, period_id) do update set
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        revenue = excluded.revenue,
        expenses = excluded.expenses,
        net_profit = excluded.net_profit,
        refreshed_at = now();

      v_count := v_count + 1;
    end loop;

    raise notice 'business % -> % rows', b.business_id, v_count;
  end loop;
end $$;

select count(*) as total_summary_rows from service_dashboard_period_summary;
select count(distinct business_id) as businesses_with_summary from service_dashboard_period_summary;
*/
