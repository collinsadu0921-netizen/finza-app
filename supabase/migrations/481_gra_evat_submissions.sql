-- ============================================================================
-- Phase 3C: GRA E-VAT submission persistence (audit trail; no HTTP / no secrets)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE public.gra_evat_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices (id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.business_gra_evat_enrollments (id) ON DELETE SET NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'queued',
        'submitting',
        'submitted',
        'accepted',
        'rejected',
        'failed',
        'cancelled'
      )
    ),
  submission_type text NOT NULL DEFAULT 'invoice'
    CHECK (
      submission_type IN (
        'invoice',
        'refund',
        'partial_refund',
        'cancellation',
        'credit_note',
        'debit_note'
      )
    ),
  idempotency_key text NOT NULL,
  request_hash text,
  draft_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_payload jsonb,
  response_payload jsonb,
  gra_reference text,
  ysdcid text,
  ysdcrecnum text,
  ysdcregsig text,
  ysdcintdata text,
  ysdcmrc text,
  qr_code text,
  authority_timestamp timestamptz,
  error_code text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  failed_at timestamptz,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gra_evat_submissions_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT gra_evat_submissions_retry_count_non_negative CHECK (retry_count >= 0),
  CONSTRAINT gra_evat_submissions_draft_snapshot_object CHECK (jsonb_typeof(draft_snapshot) = 'object'),
  CONSTRAINT gra_evat_submissions_request_payload_object CHECK (
    request_payload IS NULL OR jsonb_typeof(request_payload) = 'object'
  ),
  CONSTRAINT gra_evat_submissions_response_payload_object CHECK (
    response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'
  )
);

COMMENT ON TABLE public.gra_evat_submissions IS
  'Audit trail for GRA E-VAT submission attempts and authority responses. No plaintext VSDC/security keys. Prefer server-side writes (service role); HTTP integration comes later.';

COMMENT ON COLUMN public.gra_evat_submissions.draft_snapshot IS
  'Frozen Finza E-VAT draft (JSON). May contain taxpayer/customer data — handle per retention policy.';

COMMENT ON COLUMN public.gra_evat_submissions.request_payload IS
  'Outbound payload snapshot when submitted (no secrets).';

COMMENT ON COLUMN public.gra_evat_submissions.response_payload IS
  'Authority response body snapshot (may contain fiscal identifiers).';

CREATE INDEX gra_evat_submissions_business_id_idx ON public.gra_evat_submissions (business_id);

CREATE INDEX gra_evat_submissions_invoice_id_idx ON public.gra_evat_submissions (invoice_id);

CREATE INDEX gra_evat_submissions_enrollment_id_idx ON public.gra_evat_submissions (enrollment_id);

CREATE INDEX gra_evat_submissions_environment_idx ON public.gra_evat_submissions (environment);

CREATE INDEX gra_evat_submissions_status_idx ON public.gra_evat_submissions (status);

CREATE INDEX gra_evat_submissions_idempotency_key_idx ON public.gra_evat_submissions (idempotency_key);

CREATE INDEX gra_evat_submissions_business_env_status_idx
  ON public.gra_evat_submissions (business_id, environment, status);

CREATE INDEX gra_evat_submissions_invoice_env_submission_type_idx
  ON public.gra_evat_submissions (invoice_id, environment, submission_type);

-- At most one non-terminal submission pipeline per invoice + environment + submission_type.
CREATE UNIQUE INDEX gra_evat_submissions_open_invoice_env_type_unique
  ON public.gra_evat_submissions (invoice_id, environment, submission_type)
  WHERE status IN ('draft', 'queued', 'submitting', 'submitted');

CREATE TRIGGER gra_evat_submissions_updated_at
  BEFORE UPDATE ON public.gra_evat_submissions
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.gra_evat_submissions ENABLE ROW LEVEL SECURITY;

-- Members can read submission history for their businesses.
CREATE POLICY gra_evat_submissions_select
  ON public.gra_evat_submissions FOR SELECT
  USING (public.finza_user_can_access_business (business_id));

-- INSERT/UPDATE intentionally omitted for authenticated role: writes via service-role API routes later.
