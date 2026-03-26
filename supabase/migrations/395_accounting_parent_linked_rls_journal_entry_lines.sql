-- Phase 7: Parent-linked accounting RLS expansion
-- Scope: journal_entry_lines inherits business scope from journal_entries

alter table public.journal_entry_lines enable row level security;

drop policy if exists accounting_business_scope_journal_entry_lines on public.journal_entry_lines;

create policy accounting_business_scope_journal_entry_lines
on public.journal_entry_lines
for all
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.journal_entries je
    where je.id = journal_entry_lines.journal_entry_id
      and je.business_id = current_setting('app.current_business_id', true)::uuid
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.journal_entries je
    where je.id = journal_entry_lines.journal_entry_id
      and je.business_id = current_setting('app.current_business_id', true)::uuid
  )
);
