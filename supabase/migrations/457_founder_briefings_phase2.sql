-- Phase 2 Akwasi: extra structured fields on founder_briefings (decision highlights + area snapshot).

ALTER TABLE public.founder_briefings
  ADD COLUMN IF NOT EXISTS decision_highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.founder_briefings
  ADD COLUMN IF NOT EXISTS area_overview jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.founder_briefings.decision_highlights IS 'LLM-generated bullets tying active decisions to priorities.';
COMMENT ON COLUMN public.founder_briefings.area_overview IS 'Server-computed per-area task/decision/note snapshot at briefing time.';
