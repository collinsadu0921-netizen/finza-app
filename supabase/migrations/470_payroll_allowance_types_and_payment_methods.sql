-- Payroll: custom allowance types per business + staff payment methods scaffold (storage only).
-- Does not alter payroll calculations; keeps legacy allowances.type CHECK and column.

-- ── payroll_allowance_types ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_allowance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NULL,
  description text NULL,
  maps_to_bucket text NOT NULL DEFAULT 'regular',
  is_taxable boolean NOT NULL DEFAULT true,
  is_pensionable boolean NOT NULL DEFAULT false,
  default_recurring boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT chk_payroll_allowance_types_maps_to_bucket
    CHECK (maps_to_bucket IN ('regular', 'bonus', 'overtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_allowance_types_active_name_lower
  ON public.payroll_allowance_types (business_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_allowance_types_business_id
  ON public.payroll_allowance_types(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_allowance_types_business_active
  ON public.payroll_allowance_types(business_id, is_active)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_allowance_types_business_bucket
  ON public.payroll_allowance_types(business_id, maps_to_bucket)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.payroll_allowance_types IS
  'Business-defined payroll allowance classifications; legacy allowances.type retains DB CHECK-compatible bucket.';
COMMENT ON COLUMN public.payroll_allowance_types.maps_to_bucket IS
  'Engine bucket: bonus/overtime vs regular allowances; does not replace legacy type column.';
COMMENT ON COLUMN public.payroll_allowance_types.is_taxable IS
  'Stored for future Ghana allowance-tax treatment; not consumed in payroll engine Phase 470.';

ALTER TABLE public.payroll_allowance_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage payroll_allowance_types for their business"
  ON public.payroll_allowance_types FOR ALL
  USING (public.finza_user_can_access_business(payroll_allowance_types.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_allowance_types.business_id));

DROP TRIGGER IF EXISTS update_payroll_allowance_types_updated_at ON public.payroll_allowance_types;
CREATE TRIGGER update_payroll_allowance_types_updated_at
  BEFORE UPDATE ON public.payroll_allowance_types
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ── staff_payment_methods (scaffold; no integrations) ────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  method_type text NOT NULL,
  provider_name text NULL,
  bank_name text NULL,
  bank_code text NULL,
  branch_name text NULL,
  account_number text NULL,
  account_name text NULL,
  momo_provider text NULL,
  momo_number text NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT chk_staff_payment_methods_method_type
    CHECK (method_type IN ('bank', 'momo', 'cash')),
  CONSTRAINT chk_staff_payment_methods_verification_status
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_payment_methods_one_default
  ON public.staff_payment_methods(staff_id)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_payment_methods_business_id
  ON public.staff_payment_methods(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_payment_methods_staff_id
  ON public.staff_payment_methods(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_payment_methods_business_staff
  ON public.staff_payment_methods(business_id, staff_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_payment_methods_business_staff_default
  ON public.staff_payment_methods(business_id, staff_id, is_default)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.staff_payment_methods IS
  'Future salary payout destinations; storage only — no provider calls or secrets.';

ALTER TABLE public.staff_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage staff_payment_methods for their business staff"
  ON public.staff_payment_methods FOR ALL
  USING (
    public.finza_user_can_access_business(staff_payment_methods.business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
  )
  WITH CHECK (
    public.finza_user_can_access_business(staff_payment_methods.business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
  );

DROP TRIGGER IF EXISTS update_staff_payment_methods_updated_at ON public.staff_payment_methods;
CREATE TRIGGER update_staff_payment_methods_updated_at
  BEFORE UPDATE ON public.staff_payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ── allowances.allowance_type_id ─────────────────────────────────────────────
ALTER TABLE public.allowances
  ADD COLUMN IF NOT EXISTS allowance_type_id uuid NULL
  REFERENCES public.payroll_allowance_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_allowances_allowance_type_id
  ON public.allowances(allowance_type_id)
  WHERE deleted_at IS NULL;

-- ── Seed defaults (idempotent per business) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_default_payroll_allowance_types(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payroll_allowance_types pat
    WHERE pat.business_id = p_business_id AND pat.deleted_at IS NULL
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.payroll_allowance_types (
    business_id, name, code, description, maps_to_bucket,
    is_taxable, is_pensionable, default_recurring, is_system, is_active, sort_order
  )
  VALUES
    (p_business_id, 'Transport allowance', 'transport', NULL, 'regular', true, false, true, true, true, 10),
    (p_business_id, 'Housing allowance', 'housing', NULL, 'regular', true, false, true, true, true, 20),
    (p_business_id, 'Utility allowance', 'utility', NULL, 'regular', true, false, true, true, true, 30),
    (p_business_id, 'Medical allowance', 'medical', NULL, 'regular', true, false, true, true, true, 40),
    (p_business_id, 'Meal / food allowance', 'meal', NULL, 'regular', true, false, true, true, true, 50),
    (p_business_id, 'Communication allowance', 'communication', NULL, 'regular', true, false, true, true, true, 60),
    (p_business_id, 'Fuel allowance', 'fuel', NULL, 'regular', true, false, true, true, true, 70),
    (p_business_id, 'Risk allowance', 'risk', NULL, 'regular', true, false, true, true, true, 80),
    (p_business_id, 'Commission', 'commission', NULL, 'regular', true, false, true, true, true, 90),
    (p_business_id, 'Bonus', 'bonus', NULL, 'bonus', true, false, false, true, true, 100),
    (p_business_id, 'Overtime', 'overtime', NULL, 'overtime', true, false, false, true, true, 110),
    (p_business_id, 'Other allowance', 'other', NULL, 'regular', true, false, true, true, true, 120);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_payroll_allowance_types(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.tr_seed_payroll_allowance_types_after_business_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_payroll_allowance_types(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_seed_payroll_allowance_types_after_business_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS seed_payroll_allowance_types_after_business_insert ON public.businesses;
CREATE TRIGGER seed_payroll_allowance_types_after_business_insert
  AFTER INSERT ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_seed_payroll_allowance_types_after_business_insert();

-- Void function: use PERFORM in DO so the SQL editor does not show one empty row per business.
DO $seed_default_payroll_allowance_types$
DECLARE
  _business_id uuid;
BEGIN
  FOR _business_id IN SELECT id FROM public.businesses
  LOOP
    PERFORM public.seed_default_payroll_allowance_types(_business_id);
  END LOOP;
END
$seed_default_payroll_allowance_types$;

-- Backfill allowance_type_id from legacy type matching seeded codes
UPDATE public.allowances a
SET allowance_type_id = pat.id
FROM public.staff s
JOIN public.payroll_allowance_types pat
  ON pat.business_id = s.business_id
  AND pat.deleted_at IS NULL
WHERE a.staff_id = s.id
  AND a.deleted_at IS NULL
  AND a.allowance_type_id IS NULL
  AND lower(trim(pat.code)) = lower(trim(a.type::text));
