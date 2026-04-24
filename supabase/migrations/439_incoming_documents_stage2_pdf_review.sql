-- Stage 2: PDF extraction metadata + human review fields + reviewed status

-- ── incoming_document_extractions: diagnostics for PDF vs image paths ─────
ALTER TABLE public.incoming_document_extractions
  ADD COLUMN IF NOT EXISTS extraction_mode TEXT,
  ADD COLUMN IF NOT EXISTS source_mime TEXT,
  ADD COLUMN IF NOT EXISTS page_count INT,
  ADD COLUMN IF NOT EXISTS extraction_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.incoming_document_extractions.extraction_mode IS
  'image_ocr | pdf_text | pdf_ocr | pdf_hybrid — how raw_text was produced';
COMMENT ON COLUMN public.incoming_document_extractions.extraction_warnings IS
  'Array of short warning strings (e.g. raster fallback, page cap).';

-- ── incoming_documents: review overlay (machine output stays on extraction row) ──
ALTER TABLE public.incoming_documents
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reviewed_fields JSONB,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.incoming_documents
  DROP CONSTRAINT IF EXISTS incoming_documents_review_status_check;

ALTER TABLE public.incoming_documents
  ADD CONSTRAINT incoming_documents_review_status_check
  CHECK (review_status IN ('none', 'draft', 'accepted'));

COMMENT ON COLUMN public.incoming_documents.reviewed_fields IS
  'User-corrected field values; original machine parse remains on latest extraction.parsed_json.';
COMMENT ON COLUMN public.incoming_documents.review_status IS
  'none: machine only; draft: saved edits; accepted: user finalized review.';

-- Extend lifecycle status with "reviewed"
ALTER TABLE public.incoming_documents
  DROP CONSTRAINT IF EXISTS incoming_documents_status_check;

ALTER TABLE public.incoming_documents
  ADD CONSTRAINT incoming_documents_status_check
  CHECK (status IN (
    'uploaded',
    'extracting',
    'extracted',
    'needs_review',
    'reviewed',
    'failed',
    'linked'
  ));
