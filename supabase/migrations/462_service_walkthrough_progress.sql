-- Service workspace: durable per-user, per-business walkthrough progress (independent of onboarding).

CREATE TABLE IF NOT EXISTS public.service_walkthrough_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  tour_key text NOT NULL,
  tour_version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('completed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  skipped_at timestamptz,
  CONSTRAINT service_walkthrough_progress_user_business_tour_key UNIQUE (user_id, business_id, tour_key)
);

CREATE INDEX IF NOT EXISTS idx_service_walkthrough_progress_user_business
  ON public.service_walkthrough_progress (user_id, business_id);

COMMENT ON TABLE public.service_walkthrough_progress IS
  'Finza Service in-app tour completion/skipped state; not tied to businesses.onboarding_step.';

ALTER TABLE public.service_walkthrough_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.service_walkthrough_progress TO authenticated;

-- Owner or business_users member may read/write their own rows for that business.
CREATE POLICY service_walkthrough_progress_select
  ON public.service_walkthrough_progress
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = service_walkthrough_progress.business_id
          AND b.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = service_walkthrough_progress.business_id
          AND bu.user_id = auth.uid()
      )
    )
  );

CREATE POLICY service_walkthrough_progress_insert
  ON public.service_walkthrough_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = service_walkthrough_progress.business_id
          AND b.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = service_walkthrough_progress.business_id
          AND bu.user_id = auth.uid()
      )
    )
  );

CREATE POLICY service_walkthrough_progress_update
  ON public.service_walkthrough_progress
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = service_walkthrough_progress.business_id
          AND b.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = service_walkthrough_progress.business_id
          AND bu.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.businesses b
        WHERE b.id = service_walkthrough_progress.business_id
          AND b.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.business_id = service_walkthrough_progress.business_id
          AND bu.user_id = auth.uid()
      )
    )
  );
