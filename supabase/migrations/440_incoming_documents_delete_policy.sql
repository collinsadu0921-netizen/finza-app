-- Restored: RLS DELETE on incoming_documents (was dropped when 439 was replaced by stage2 PDF review).
-- Needed for DELETE /api/incoming-documents/[id] — expense/bill create "Remove file" cleanup.

DROP POLICY IF EXISTS "incoming_documents_delete" ON public.incoming_documents;
CREATE POLICY "incoming_documents_delete"
  ON public.incoming_documents FOR DELETE
  USING (public.finza_user_can_access_business(business_id));
