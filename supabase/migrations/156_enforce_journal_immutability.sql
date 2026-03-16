CREATE OR REPLACE FUNCTION prevent_journal_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Journal entries are immutable (append-only). Cannot UPDATE journal entry. Use adjustment journals for corrections.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journal entries are immutable (append-only). Cannot DELETE journal entry. Use adjustment journals for corrections.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_journal_entry_modification ON journal_entries;
CREATE TRIGGER trigger_prevent_journal_entry_modification
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_journal_entry_modification();

CREATE OR REPLACE FUNCTION prevent_journal_entry_line_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot UPDATE journal entry line. Use adjustment journals for corrections.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot DELETE journal entry line. Use adjustment journals for corrections.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_journal_entry_line_modification ON journal_entry_lines;
CREATE TRIGGER trigger_prevent_journal_entry_line_modification
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION prevent_journal_entry_line_modification();
