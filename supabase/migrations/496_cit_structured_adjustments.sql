-- Phase 2 CIT: structured adjustments and provision recalculation totals.

ALTER TABLE public.cit_provisions
  ADD COLUMN IF NOT EXISTS add_backs_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_revenue NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.cit_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provision_id UUID NOT NULL REFERENCES public.cit_provisions(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('add_back', 'deduction')),
  category TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  notes TEXT,
  account_id UUID REFERENCES public.accounts(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cit_adjustments_business_provision
  ON public.cit_adjustments (business_id, provision_id);

CREATE INDEX IF NOT EXISTS idx_cit_adjustments_business_type
  ON public.cit_adjustments (business_id, adjustment_type);

CREATE INDEX IF NOT EXISTS idx_cit_adjustments_account_id
  ON public.cit_adjustments (account_id);

ALTER TABLE public.cit_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service trial read select" ON public.cit_adjustments;
DROP POLICY IF EXISTS "service trial write insert" ON public.cit_adjustments;
DROP POLICY IF EXISTS "service trial write update" ON public.cit_adjustments;
DROP POLICY IF EXISTS "service trial write delete" ON public.cit_adjustments;

CREATE POLICY "service trial read select" ON public.cit_adjustments FOR SELECT
USING (public.finza_user_can_access_business(cit_adjustments.business_id));

CREATE POLICY "service trial write insert" ON public.cit_adjustments FOR INSERT
WITH CHECK (
  public.finza_service_trial_rls_can_write(cit_adjustments.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.cit_provisions cp
    WHERE cp.id = cit_adjustments.provision_id
      AND cp.business_id = cit_adjustments.business_id
      AND cp.status = 'draft'
  )
  AND (
    cit_adjustments.account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = cit_adjustments.account_id
        AND a.business_id = cit_adjustments.business_id
        AND a.deleted_at IS NULL
    )
  )
);

CREATE POLICY "service trial write update" ON public.cit_adjustments FOR UPDATE
USING (
  public.finza_service_trial_rls_can_write(cit_adjustments.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.cit_provisions cp
    WHERE cp.id = cit_adjustments.provision_id
      AND cp.business_id = cit_adjustments.business_id
      AND cp.status = 'draft'
  )
)
WITH CHECK (
  public.finza_service_trial_rls_can_write(cit_adjustments.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.cit_provisions cp
    WHERE cp.id = cit_adjustments.provision_id
      AND cp.business_id = cit_adjustments.business_id
      AND cp.status = 'draft'
  )
  AND (
    cit_adjustments.account_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = cit_adjustments.account_id
        AND a.business_id = cit_adjustments.business_id
        AND a.deleted_at IS NULL
    )
  )
);

CREATE POLICY "service trial write delete" ON public.cit_adjustments FOR DELETE
USING (
  public.finza_service_trial_rls_can_write(cit_adjustments.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.cit_provisions cp
    WHERE cp.id = cit_adjustments.provision_id
      AND cp.business_id = cit_adjustments.business_id
      AND cp.status = 'draft'
  )
);

CREATE OR REPLACE FUNCTION public.set_cit_adjustments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cit_adjustments_updated_at ON public.cit_adjustments;
CREATE TRIGGER trg_cit_adjustments_updated_at
BEFORE UPDATE ON public.cit_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.set_cit_adjustments_updated_at();

COMMENT ON TABLE public.cit_adjustments IS
  'Structured Corporate Income Tax adjustments for add-backs and deductions attached to CIT provisions.';

COMMENT ON COLUMN public.cit_provisions.add_backs_total IS
  'Sum of structured CIT add-back adjustments for this provision.';

COMMENT ON COLUMN public.cit_provisions.deductions_total IS
  'Sum of structured CIT deduction adjustments for this provision.';

COMMENT ON COLUMN public.cit_provisions.gross_revenue IS
  'Gross revenue snapshot used to preserve AMT/minimum-tax behavior when recalculating after adjustments.';
