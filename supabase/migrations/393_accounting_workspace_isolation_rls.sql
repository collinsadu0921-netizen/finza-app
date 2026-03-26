-- Enforce accounting workspace isolation on core accounting journal table.
-- This migration is idempotent and safe to run when table/policy already exists.

DO $$
BEGIN
  IF to_regclass('public.accounting_journal_entries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.accounting_journal_entries ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS accounting_isolation ON public.accounting_journal_entries';

    EXECUTE $POLICY$
      CREATE POLICY accounting_isolation
      ON public.accounting_journal_entries
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND workspace = ''accounting''
        AND team_id = current_setting('app.current_team_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND workspace = ''accounting''
        AND team_id = current_setting('app.current_team_id', true)::uuid
      )
    $POLICY$;
  END IF;
END $$;
