-- Add fee_journal_entry_id to bank_transactions so fee entries can be reversed on unmatch
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS fee_journal_entry_id UUID REFERENCES journal_entries(id);
