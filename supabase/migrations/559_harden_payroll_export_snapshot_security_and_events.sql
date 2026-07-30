-- ============================================================================
-- Migration 559: Harden payroll export snapshot security and download events
-- ============================================================================
-- Staging only. Migrations 552-558 unchanged. Production untouched.
--
-- Fixes:
-- 1) Revoke direct authenticated table access; RLS requires payroll.export
-- 2) Immutable snapshot/event rows (reject UPDATE/DELETE)
-- 3) Approval-time snapshots labelled approved with matching approved_at/by
-- 4) Retrieval RPC never records download events
-- 5) Event RPC records exact delivered content hash after route-side render
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Inspect existing source_run_status before CHECK (fail closed)
-- ---------------------------------------------------------------------------
DO $guard_status$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(
    format('snapshot=%s business=%s run=%s status=%s', id, business_id, payroll_run_id, source_run_status),
    '; '
  )
  INTO v_bad
  FROM public.payroll_export_snapshots
  WHERE source_run_status IS DISTINCT FROM 'approved'
  LIMIT 50;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS: non-approved snapshots exist — %',
      v_bad
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'code', 'PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS',
              'message', 'Cannot add approved-only CHECK while non-approved snapshots remain'
            )::TEXT;
  END IF;
END;
$guard_status$;

ALTER TABLE public.payroll_export_snapshots
  DROP CONSTRAINT IF EXISTS payroll_export_snapshots_source_run_status_check;

ALTER TABLE public.payroll_export_snapshots
  ADD CONSTRAINT payroll_export_snapshots_source_run_status_check
  CHECK (source_run_status = 'approved');

-- ---------------------------------------------------------------------------
-- 2) Event metadata columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_export_events
  ADD COLUMN IF NOT EXISTS renderer_version TEXT,
  ADD COLUMN IF NOT EXISTS content_length BIGINT,
  ADD COLUMN IF NOT EXISTS run_status_at_download TEXT;

-- Empty staging table: enforce NOT NULL after backfill of any NULLs (none expected).
UPDATE public.payroll_export_events
SET
  renderer_version = COALESCE(NULLIF(TRIM(renderer_version), ''), 'unknown'),
  content_length = COALESCE(content_length, 0),
  run_status_at_download = COALESCE(NULLIF(TRIM(run_status_at_download), ''), 'unknown')
WHERE renderer_version IS NULL
   OR content_length IS NULL
   OR run_status_at_download IS NULL;

ALTER TABLE public.payroll_export_events
  ALTER COLUMN renderer_version SET NOT NULL,
  ALTER COLUMN content_length SET NOT NULL,
  ALTER COLUMN run_status_at_download SET NOT NULL;

ALTER TABLE public.payroll_export_events
  DROP CONSTRAINT IF EXISTS payroll_export_events_content_length_check;

ALTER TABLE public.payroll_export_events
  ADD CONSTRAINT payroll_export_events_content_length_check
  CHECK (content_length >= 0);

ALTER TABLE public.payroll_export_events
  DROP CONSTRAINT IF EXISTS payroll_export_events_source_run_status_check;

ALTER TABLE public.payroll_export_events
  ADD CONSTRAINT payroll_export_events_source_run_status_check
  CHECK (source_run_status = 'approved');

-- ---------------------------------------------------------------------------
-- 3) Revoke direct client table access
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.payroll_export_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payroll_export_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payroll_export_snapshots TO postgres, service_role;
GRANT ALL ON TABLE public.payroll_export_events TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 4) Defence-in-depth RLS (no client DML policies)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payroll_export_snapshots_select_business
  ON public.payroll_export_snapshots;
DROP POLICY IF EXISTS payroll_export_events_select_business
  ON public.payroll_export_events;
DROP POLICY IF EXISTS payroll_export_snapshots_select_export
  ON public.payroll_export_snapshots;
DROP POLICY IF EXISTS payroll_export_events_select_export
  ON public.payroll_export_events;

CREATE POLICY payroll_export_snapshots_select_export
  ON public.payroll_export_snapshots
  FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.export')
  );

CREATE POLICY payroll_export_events_select_export
  ON public.payroll_export_events
  FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.export')
  );

-- ---------------------------------------------------------------------------
-- 5) Immutability triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_export_snapshots_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  PERFORM public.raise_payroll_export_error(
    'PAYROLL_EXPORT_SNAPSHOT_IMMUTABLE',
    'Payroll export snapshots cannot be updated or deleted'
  );
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_export_events_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  PERFORM public.raise_payroll_export_error(
    'PAYROLL_EXPORT_EVENT_IMMUTABLE',
    'Payroll export events cannot be updated or deleted'
  );
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_payroll_export_snapshots_immutable
  ON public.payroll_export_snapshots;
CREATE TRIGGER trg_payroll_export_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_export_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_export_snapshots_reject_mutation();

DROP TRIGGER IF EXISTS trg_payroll_export_events_immutable
  ON public.payroll_export_events;
CREATE TRIGGER trg_payroll_export_events_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_export_events
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_export_events_reject_mutation();

REVOKE ALL ON FUNCTION public.payroll_export_snapshots_reject_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_export_events_reject_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_export_snapshots_reject_mutation() TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_export_events_reject_mutation() TO postgres;

-- ---------------------------------------------------------------------------
-- 6) Label approval-time snapshots as approved (same txn timestamp/actor)
-- ---------------------------------------------------------------------------
DO $patch_create$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_payroll_export_snapshots_for_approval(uuid,uuid,uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'create_payroll_export_snapshots_for_approval not found';
  END IF;

  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_definition := replace(v_definition, E'\r', E'\n');

  IF POSITION('''source_status'', v_run.status,' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot patch create_payroll_export_snapshots_for_approval: source_status anchor missing';
  END IF;

  v_definition := replace(
    v_definition,
    '''source_status'', v_run.status,',
    '''source_status'', ''approved'','
  );

  IF POSITION('''approved_at'', v_run.approved_at,' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot patch create_payroll_export_snapshots_for_approval: approved_at anchor missing';
  END IF;

  v_definition := replace(
    v_definition,
    '''approved_at'', v_run.approved_at,' || E'\n' ||
    '    ''approved_by'', v_run.approved_by',
    '''approved_at'', transaction_timestamp(),' || E'\n' ||
    '    ''approved_by'', p_actor_id'
  );

  -- All store_payroll_export_snapshot source_run_status arguments
  -- (including newline-separated call sites such as DT107A).
  v_definition := regexp_replace(
    v_definition,
    ',\s*v_run\.status,\s*v_payload,',
    ', ''approved'', v_payload,',
    'g'
  );

  IF v_definition ~ ',\s*v_run\.status,\s*v_payload,' THEN
    RAISE EXCEPTION
      'Cannot patch create_payroll_export_snapshots_for_approval: store status still references v_run.status';
  END IF;

  IF POSITION('''source_run_status'', v_run.status,' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot patch create_payroll_export_snapshots_for_approval: return status anchor missing';
  END IF;
  v_definition := replace(
    v_definition,
    '''source_run_status'', v_run.status,',
    '''source_run_status'', ''approved'','
  );

  EXECUTE v_definition;
END;
$patch_create$;

-- Patch approve_payroll_run_atomic so run.approved_at uses transaction_timestamp()
-- (same value create_payroll_export_snapshots_for_approval writes into payloads).
DO $patch_approve$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.approve_payroll_run_atomic(uuid,uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'approve_payroll_run_atomic not found';
  END IF;

  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_definition := replace(v_definition, E'\r', E'\n');

  -- Prefer transaction_timestamp() for the authoritative approval instant.
  IF POSITION('approved_at = NOW(),' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'approved_at = NOW(),',
      'approved_at = transaction_timestamp(),'
    );
  ELSIF POSITION('approved_at = transaction_timestamp(),' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot patch approve_payroll_run_atomic: approved_at assignment not found';
  END IF;

  -- Ensure audit after-state includes the same approved_at when present as NOW().
  IF POSITION('''approved_at'', NOW()' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      '''approved_at'', NOW()',
      '''approved_at'', transaction_timestamp()'
    );
  END IF;

  EXECUTE v_definition;
END;
$patch_approve$;

-- ---------------------------------------------------------------------------
-- 7) Retrieval RPC: verify only — never record events
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_payroll_export_snapshot_for_download(
  UUID, UUID, TEXT, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.get_payroll_export_snapshot_for_download(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_export_type TEXT,
  p_mode TEXT DEFAULT 'preparation'
)
RETURNS SETOF public.payroll_export_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot public.payroll_export_snapshots%ROWTYPE;
  v_run_status TEXT;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.export') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_PERMISSION_DENIED',
      'Payroll export permission required'
    );
  END IF;

  IF p_mode NOT IN ('preparation', 'audit') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_INVALID_MODE',
      'Export mode must be preparation or audit'
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.payroll_export_snapshots s
  WHERE s.business_id = p_business_id
    AND s.payroll_run_id = p_payroll_run_id
    AND s.export_type = p_export_type
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT pr.status INTO v_run_status
    FROM public.payroll_runs pr
    WHERE pr.id = p_payroll_run_id
      AND pr.business_id = p_business_id;

    IF v_run_status IN ('approved', 'locked', 'reversed') THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING',
        'No approval-time export snapshot exists for this historical payroll run',
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING',
          'payrollRunId', p_payroll_run_id,
          'exportType', p_export_type,
          'runStatus', v_run_status
        )
      );
    END IF;

    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_NOT_FOUND',
      'No immutable export snapshot exists for this payroll run and export type'
    );
  END IF;

  IF v_snapshot.source_run_status IS DISTINCT FROM 'approved' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS',
      'Export snapshot source_run_status must be approved',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS',
        'snapshotId', v_snapshot.id,
        'sourceRunStatus', v_snapshot.source_run_status
      )
    );
  END IF;

  IF NOT public.verify_payroll_export_snapshot(v_snapshot.id) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
      'Payroll export snapshot failed hash verification',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
        'snapshotId', v_snapshot.id
      )
    );
  END IF;

  SELECT pr.status INTO v_run_status
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id;

  IF p_mode = 'preparation' AND v_run_status = 'reversed' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_RUN_REVERSED',
      'Preparation export is unavailable because this payroll run was reversed'
    );
  END IF;

  -- Intentionally does not insert payroll_export_events.
  RETURN NEXT v_snapshot;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8) Event RPC: record exact delivered content hash after route render
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.record_payroll_export_event(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_snapshot_id UUID,
  p_export_type TEXT,
  p_mode TEXT,
  p_actual_content_sha256 TEXT,
  p_filename TEXT,
  p_renderer_version TEXT,
  p_content_length BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot public.payroll_export_snapshots%ROWTYPE;
  v_run_status TEXT;
  v_id UUID;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.export') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_PERMISSION_DENIED',
      'Payroll export permission required'
    );
  END IF;

  IF p_mode NOT IN ('preparation', 'audit') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_INVALID_MODE',
      'Export mode must be preparation or audit'
    );
  END IF;

  IF p_actual_content_sha256 IS NULL
     OR p_actual_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'Actual content SHA-256 must be a 64-character lowercase hex digest'
    );
  END IF;

  IF NULLIF(TRIM(COALESCE(p_filename, '')), '') IS NULL
     OR p_filename ~ '[\\/\x00]'
     OR length(p_filename) > 255 THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'Export filename is missing or unsafe'
    );
  END IF;

  IF p_content_length IS NULL OR p_content_length < 0 THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'content_length must be >= 0'
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.payroll_export_snapshots s
  WHERE s.id = p_snapshot_id
    AND s.business_id = p_business_id
    AND s.payroll_run_id = p_payroll_run_id
    AND s.export_type = p_export_type;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'Snapshot ownership/export-type validation failed for download event'
    );
  END IF;

  IF v_snapshot.source_run_status IS DISTINCT FROM 'approved' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_INVALID_SOURCE_STATUS',
      'Export snapshot source_run_status must be approved'
    );
  END IF;

  IF NOT public.verify_payroll_export_snapshot(p_snapshot_id) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
      'Payroll export snapshot failed hash verification before event recording'
    );
  END IF;

  IF NULLIF(TRIM(COALESCE(p_renderer_version, '')), '') IS DISTINCT FROM v_snapshot.renderer_version THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'Renderer version must match the immutable snapshot renderer_version',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        'expectedRenderer', v_snapshot.renderer_version,
        'receivedRenderer', p_renderer_version
      )
    );
  END IF;

  SELECT pr.status INTO v_run_status
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id;

  IF v_run_status IS NULL THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'Payroll run not found for download event'
    );
  END IF;

  IF p_mode = 'preparation' AND v_run_status = 'reversed' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_RUN_REVERSED',
      'Preparation export is unavailable because this payroll run was reversed'
    );
  END IF;

  -- DT107A preparation must match the stored rendered bytes exactly.
  IF p_export_type = 'gra_dt107a'
     AND p_mode = 'preparation'
     AND p_actual_content_sha256 IS DISTINCT FROM v_snapshot.rendered_content_sha256 THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
      'DT107A preparation content hash must equal snapshot.rendered_content_sha256',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        'expectedHash', v_snapshot.rendered_content_sha256,
        'receivedHash', p_actual_content_sha256
      )
    );
  END IF;

  BEGIN
    INSERT INTO public.payroll_export_events (
      business_id,
      payroll_run_id,
      snapshot_id,
      export_type,
      mode,
      actor_id,
      downloaded_at,
      content_sha256,
      filename,
      source_run_status,
      renderer_version,
      content_length,
      run_status_at_download
    ) VALUES (
      p_business_id,
      p_payroll_run_id,
      p_snapshot_id,
      p_export_type,
      p_mode,
      v_uid,
      NOW(),
      p_actual_content_sha256,
      p_filename,
      'approved',
      v_snapshot.renderer_version,
      p_content_length,
      v_run_status
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        COALESCE(SQLERRM, 'Failed to record payroll export download event')
      );
  END;

  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 9) Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_payroll_export_snapshot_for_download(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_export_snapshot_for_download(UUID, UUID, TEXT, TEXT)
  TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  TO postgres;

COMMENT ON FUNCTION public.get_payroll_export_snapshot_for_download(UUID, UUID, TEXT, TEXT) IS
  'Permission-gated snapshot retrieval with integrity verification; does not record download events.';
COMMENT ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) IS
  'Append-only download event for the exact delivered CSV bytes after route-side render.';
COMMENT ON POLICY payroll_export_snapshots_select_export ON public.payroll_export_snapshots IS
  'Defence in depth: membership + payroll.export required if SELECT is ever re-granted.';
