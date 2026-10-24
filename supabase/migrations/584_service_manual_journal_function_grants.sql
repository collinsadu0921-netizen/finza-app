-- ============================================================================
-- Migration 584: Service manual journal function/table grant hardening
-- ============================================================================
-- Supabase default privileges can grant EXECUTE to anon/authenticated on new
-- functions independently of PUBLIC. Migration 583 revoked PUBLIC but live
-- verification showed anon still had EXECUTE. This migration removes those
-- explicit grants and restores only the intended authenticated entry points.
-- ============================================================================

REVOKE ALL ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.service_manual_journal_actor_role(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_manual_journal_assert_open_period(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_manual_journal_validate_lines(UUID, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_service_manual_journal_draft(UUID, DATE, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_service_manual_journal_draft(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_service_manual_journal_draft(UUID, DATE, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_service_manual_journal_draft(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) TO authenticated;

REVOKE ALL ON TABLE public.service_manual_journal_drafts FROM anon;
GRANT SELECT ON TABLE public.service_manual_journal_drafts TO authenticated;
