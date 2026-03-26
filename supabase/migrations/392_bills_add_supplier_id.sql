-- Add optional supplier linkage on bills while retaining supplier snapshot fields.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS supplier_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bills_supplier_id_fkey'
      AND conrelid = 'public.bills'::regclass
  ) THEN
    ALTER TABLE public.bills
      ADD CONSTRAINT bills_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bills_supplier_id
  ON public.bills(supplier_id);

