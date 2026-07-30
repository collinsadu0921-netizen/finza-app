-- Migration 565: payroll CSV UTF-8 BOM delivery hash alignment
--
-- Snapshot rendered_content / rendered_content_sha256 remain immutable and BOM-free.
-- HTTP delivery prepends UTF-8 BOM (EF BB BF) for Excel/Windows.
-- Download events must hash the exact delivered bytes (including BOM).
--
-- Staging-only apply for this release cycle; do not apply to production from this task.

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
  v_delivered_preparation_hash TEXT;
  v_delivered_preparation_length BIGINT;
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

  -- DT107A preparation: snapshot bytes stay BOM-free; delivered bytes include UTF-8 BOM.
  -- Event hash/length must match the exact delivered payload.
  IF p_export_type = 'gra_dt107a' AND p_mode = 'preparation' THEN
    IF v_snapshot.rendered_content IS NULL OR v_snapshot.rendered_content_sha256 IS NULL THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        'DT107A preparation snapshot is missing rendered_content'
      );
    END IF;

    v_delivered_preparation_hash := encode(
      digest(
        E'\\xEFBBBF'::bytea || convert_to(v_snapshot.rendered_content, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    v_delivered_preparation_length := octet_length(
      E'\\xEFBBBF'::bytea || convert_to(v_snapshot.rendered_content, 'UTF8')
    );

    IF p_actual_content_sha256 IS DISTINCT FROM v_delivered_preparation_hash THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        'DT107A preparation content hash must equal SHA-256 of UTF-8 BOM + snapshot.rendered_content',
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
          'expectedDeliveredHash', v_delivered_preparation_hash,
          'snapshotRenderedHash', v_snapshot.rendered_content_sha256,
          'receivedHash', p_actual_content_sha256
        )
      );
    END IF;

    IF p_content_length IS DISTINCT FROM v_delivered_preparation_length THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
        'DT107A preparation content_length must equal UTF-8 BOM + snapshot.rendered_content byte length',
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_EVENT_RECORDING_FAILED',
          'expectedDeliveredLength', v_delivered_preparation_length,
          'receivedLength', p_content_length
        )
      );
    END IF;
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

COMMENT ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) IS
  'Append-only download event for exact delivered CSV bytes (UTF-8 BOM included for payroll CSV delivery). Snapshot rendered_content hashes remain BOM-free.';
