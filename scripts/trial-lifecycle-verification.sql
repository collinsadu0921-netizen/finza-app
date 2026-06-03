-- Identify unpaid trials that have ended (candidates for grace / read-only)
select
  id,
  name,
  service_subscription_tier,
  service_subscription_status,
  trial_ends_at,
  subscription_grace_until,
  subscription_started_at
from businesses
where archived_at is null
  and subscription_started_at is null
  and trial_ends_at is not null
  and trial_ends_at < now()
order by trial_ends_at;

-- Post-fix monitoring: journals created after grace on locked unpaid trials
select
  b.id,
  b.name,
  b.service_subscription_status,
  b.trial_ends_at,
  b.subscription_grace_until,
  count(je.id) as journals_after_lock
from businesses b
left join journal_entries je
  on je.business_id = b.id
 and je.created_at >= b.subscription_grace_until
where b.archived_at is null
  and b.subscription_started_at is null
  and b.service_subscription_status = 'locked'
group by b.id, b.name, b.service_subscription_status, b.trial_ends_at, b.subscription_grace_until
order by journals_after_lock desc;
