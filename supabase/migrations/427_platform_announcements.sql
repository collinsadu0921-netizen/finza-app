-- Platform announcements (internal-managed, tenant-visible).
-- RLS: no policies on platform_announcements → deny for anon/authenticated via PostgREST;
--       service role (server) bypasses RLS. Dismissals: users may insert/select own rows.

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  placement text NOT NULL DEFAULT 'global_banner'
    CHECK (placement IN ('global_banner', 'dashboard_card', 'modal')),
  audience_scope text NOT NULL DEFAULT 'all_tenants'
    CHECK (audience_scope IN (
      'all_tenants',
      'service_workspace_only',
      'retail_workspace_only',
      'accounting_workspace_only'
    )),
  dismissible boolean NOT NULL DEFAULT true,
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_status_dates
  ON public.platform_announcements (status, start_at, end_at);

CREATE TABLE IF NOT EXISTS public.platform_announcement_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.platform_announcements (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_announcement_dismissals_user
  ON public.platform_announcement_dismissals (user_id);

CREATE OR REPLACE FUNCTION public.platform_announcements_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_announcements_updated_at ON public.platform_announcements;
CREATE TRIGGER trg_platform_announcements_updated_at
  BEFORE UPDATE ON public.platform_announcements
  FOR EACH ROW EXECUTE FUNCTION public.platform_announcements_set_updated_at();

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_dismissals ENABLE ROW LEVEL SECURITY;

-- Deny direct PostgREST access: no policies on announcements or dismissals.
-- Next.js API routes use the service role after session checks.

COMMENT ON TABLE public.platform_announcements IS 'Finza-wide announcements; managed via /internal/announcements + service role APIs.';
COMMENT ON TABLE public.platform_announcement_dismissals IS 'Per-user dismissals for dismissible announcements.';
