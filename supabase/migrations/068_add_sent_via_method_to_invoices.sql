-- Add sent_via_method column to invoices table to track how invoice was sent

DO $$
BEGIN
  -- Add sent_via_method column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'invoices' 
      AND column_name = 'sent_via_method'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN sent_via_method TEXT CHECK (sent_via_method IN ('whatsapp', 'email', 'both', 'link', 'manual'));
    
    RAISE NOTICE 'Added sent_via_method column to invoices table';
  ELSE
    RAISE NOTICE 'sent_via_method column already exists';
  END IF;
END $$;

-- Add comment to document the column
COMMENT ON COLUMN invoices.sent_via_method IS 'Method used to send the invoice: whatsapp, email, both, link, or manual';

