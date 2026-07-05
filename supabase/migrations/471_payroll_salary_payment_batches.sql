-- Payroll salary payment batches: employee-level disbursement planning/export (no provider integration).
-- Coexists with payroll_payments (ledger settlement). Batch lifecycle does not post journals.

CREATE TABLE IF NOT EXISTS public.payroll_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'GHS',
  total_amount_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  funding_account_id uuid NULL REFERENCES public.accounts(id),
  payroll_payment_id uuid NULL,
  export_filename text NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES auth.users(id),
  approved_by uuid NULL REFERENCES auth.users(id),
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT chk_payroll_payment_batches_status CHECK (
    status IN (
      'draft',
      'ready',
      'pending_authorization',
      'processing',
      'partially_paid',
      'paid',
      'failed',
      'cancelled'
    )
  )
);

COMMENT ON TABLE public.payroll_payment_batches IS
  'Salary disbursement batch for a payroll run (planning/export/status only; does not post GL).';

-- At most one non-cancelled, non-deleted batch per run (v1).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payment_batches_one_active_per_run
  ON public.payroll_payment_batches(payroll_run_id)
  WHERE deleted_at IS NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_payroll_payment_batches_business_id
  ON public.payroll_payment_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batches_payroll_run_id
  ON public.payroll_payment_batches(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batches_status
  ON public.payroll_payment_batches(status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_payroll_payment_batches_updated_at ON public.payroll_payment_batches;
CREATE TRIGGER update_payroll_payment_batches_updated_at
  BEFORE UPDATE ON public.payroll_payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_payment_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage payroll_payment_batches for their business"
  ON public.payroll_payment_batches FOR ALL
  USING (public.finza_user_can_access_business(payroll_payment_batches.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_payment_batches.business_id));

CREATE TABLE IF NOT EXISTS public.payroll_payment_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.payroll_payment_batches(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_entry_id uuid NOT NULL REFERENCES public.payroll_entries(id) ON DELETE RESTRICT,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  employee_name text NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'GHS',
  status text NOT NULL DEFAULT 'pending',
  staff_payment_method_id uuid NULL REFERENCES public.staff_payment_methods(id) ON DELETE SET NULL,
  destination_method_type text NULL,
  destination_provider_name text NULL,
  destination_bank_name text NULL,
  destination_bank_code text NULL,
  destination_branch_name text NULL,
  destination_account_number text NULL,
  destination_account_name text NULL,
  destination_momo_provider text NULL,
  destination_momo_number text NULL,
  legacy_destination_source text NULL,
  payment_reference text NULL,
  provider_reference text NULL,
  failure_reason text NULL,
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT chk_payroll_payment_batch_items_status CHECK (
    status IN ('pending', 'paid', 'failed', 'skipped', 'cancelled')
  )
);

COMMENT ON TABLE public.payroll_payment_batch_items IS
  'Frozen per-employee payout rows for a batch; reads must not depend on live staff_payment_methods.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payment_batch_items_batch_entry
  ON public.payroll_payment_batch_items(batch_id, payroll_entry_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_business_id
  ON public.payroll_payment_batch_items(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_payroll_run_id
  ON public.payroll_payment_batch_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_batch_id
  ON public.payroll_payment_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_staff_id
  ON public.payroll_payment_batch_items(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_status
  ON public.payroll_payment_batch_items(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_payment_batch_items_run_status
  ON public.payroll_payment_batch_items(payroll_run_id, status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_payroll_payment_batch_items_updated_at ON public.payroll_payment_batch_items;
CREATE TRIGGER update_payroll_payment_batch_items_updated_at
  BEFORE UPDATE ON public.payroll_payment_batch_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_payment_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage payroll_payment_batch_items for their business"
  ON public.payroll_payment_batch_items FOR ALL
  USING (public.finza_user_can_access_business(payroll_payment_batch_items.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_payment_batch_items.business_id));

-- Optional links to payroll_payments.
-- Guarded so this migration can run even if payroll_payments is absent in older/local DBs.
DO $$
BEGIN
  IF to_regclass('public.payroll_payments') IS NOT NULL THEN
    -- Link from batch header to eventual payroll_payment settlement row.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'payroll_payment_batches_payroll_payment_id_fkey'
        AND conrelid = 'public.payroll_payment_batches'::regclass
    ) THEN
      ALTER TABLE public.payroll_payment_batches
        ADD CONSTRAINT payroll_payment_batches_payroll_payment_id_fkey
        FOREIGN KEY (payroll_payment_id)
        REFERENCES public.payroll_payments(id)
        ON DELETE SET NULL;
    END IF;

    -- Link from payroll_payments back to batch (nullable).
    ALTER TABLE public.payroll_payments
      ADD COLUMN IF NOT EXISTS batch_id uuid NULL REFERENCES public.payroll_payment_batches(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_payroll_payments_batch_id
      ON public.payroll_payments(batch_id)
      WHERE deleted_at IS NULL AND batch_id IS NOT NULL;
  END IF;
END $$;
