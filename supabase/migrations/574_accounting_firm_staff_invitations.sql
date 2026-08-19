-- ============================================================================
-- Practice firm staff invitations (P0.1)
-- Staging-first: partner-invited staff onboarding with secure token acceptance.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounting_firm_staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('partner', 'senior', 'junior', 'readonly')),
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_firm_staff_invitations_email_nonempty
    CHECK (length(trim(email_normalized)) > 0),
  CONSTRAINT accounting_firm_staff_invitations_token_hash_nonempty
    CHECK (length(trim(token_hash)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_staff_invitations_pending_unique
  ON public.accounting_firm_staff_invitations (firm_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_firm_staff_invitations_firm_id
  ON public.accounting_firm_staff_invitations (firm_id);

CREATE INDEX IF NOT EXISTS idx_firm_staff_invitations_token_hash_pending
  ON public.accounting_firm_staff_invitations (token_hash)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_firm_staff_invitations_status
  ON public.accounting_firm_staff_invitations (status);

COMMENT ON TABLE public.accounting_firm_staff_invitations IS
  'Pending Practice firm staff invitations. Raw tokens exist only in email/URL; token_hash stored at rest.';

DROP TRIGGER IF EXISTS trigger_update_firm_staff_invitations_updated_at
  ON public.accounting_firm_staff_invitations;
CREATE TRIGGER trigger_update_firm_staff_invitations_updated_at
  BEFORE UPDATE ON public.accounting_firm_staff_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_firm_updated_at();

ALTER TABLE public.accounting_firm_staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can view firm staff invitations"
  ON public.accounting_firm_staff_invitations;
CREATE POLICY "Partners can view firm staff invitations"
  ON public.accounting_firm_staff_invitations FOR SELECT
  USING (check_user_is_partner_in_firm(firm_id, auth.uid()));

DROP POLICY IF EXISTS "Partners can create firm staff invitations"
  ON public.accounting_firm_staff_invitations;
CREATE POLICY "Partners can create firm staff invitations"
  ON public.accounting_firm_staff_invitations FOR INSERT
  WITH CHECK (
    invited_by_user_id = auth.uid()
    AND check_user_is_partner_in_firm(firm_id, auth.uid())
  );

DROP POLICY IF EXISTS "Partners can update firm staff invitations"
  ON public.accounting_firm_staff_invitations;
CREATE POLICY "Partners can update firm staff invitations"
  ON public.accounting_firm_staff_invitations FOR UPDATE
  USING (check_user_is_partner_in_firm(firm_id, auth.uid()))
  WITH CHECK (check_user_is_partner_in_firm(firm_id, auth.uid()));

DROP POLICY IF EXISTS "Prevent delete on firm staff invitations"
  ON public.accounting_firm_staff_invitations;
CREATE POLICY "Prevent delete on firm staff invitations"
  ON public.accounting_firm_staff_invitations FOR DELETE
  USING (false);
