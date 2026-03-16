SELECT tgname, tgenabled, tgtype 
FROM pg_trigger 
WHERE tgrelid = 'journal_entries'::regclass 
  AND tgname = 'trigger_prevent_journal_entry_modification';

SELECT tgname, tgenabled, tgtype 
FROM pg_trigger 
WHERE tgrelid = 'journal_entry_lines'::regclass 
  AND tgname = 'trigger_prevent_journal_entry_line_modification';

SELECT proname 
FROM pg_proc 
WHERE proname IN ('prevent_journal_entry_modification', 'prevent_journal_entry_line_modification');
