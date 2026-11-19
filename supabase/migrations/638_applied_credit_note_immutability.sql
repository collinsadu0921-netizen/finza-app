-- Applied credit notes are posted source documents.
--
-- The credit-note journal, the AR subledger and the invoice status are written
-- from the same apply transition. Unapplying, soft-deleting, restoring or
-- repricing an applied credit note would leave the posted journal and the
-- document disagreeing, and the existing posting helpers intentionally return
-- the live journal instead of rewriting it.
--
-- Block those unsupported mutations at the database boundary. Draft and issued
-- credit notes remain fully editable. Reason/notes and presentational fields
-- stay editable on an applied note.
--
-- To correct an applied credit note, arrange a reviewed reversal of its posted
-- journal with support and then issue a replacement credit note. There is no
-- silent in-place unapply. This migration never rewrites or deletes a journal.

CREATE OR REPLACE FUNCTION public.prevent_applied_credit_note_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = 'applied' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.nhil IS DISTINCT FROM OLD.nhil
       OR NEW.getfund IS DISTINCT FROM OLD.getfund
       OR NEW.covid IS DISTINCT FROM OLD.covid
       OR NEW.vat IS DISTINCT FROM OLD.vat
       OR NEW.total_tax IS DISTINCT FROM OLD.total_tax
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.tax_lines IS DISTINCT FROM OLD.tax_lines
       OR NEW.tax_pricing_mode IS DISTINCT FROM OLD.tax_pricing_mode
       OR NEW.vat_classification IS DISTINCT FROM OLD.vat_classification
       OR NEW.tax_engine_code IS DISTINCT FROM OLD.tax_engine_code
       OR NEW.tax_engine_effective_from IS DISTINCT FROM OLD.tax_engine_effective_from
       OR NEW.tax_jurisdiction IS DISTINCT FROM OLD.tax_jurisdiction
    THEN
      RAISE EXCEPTION 'CREDIT_NOTE_APPLIED_IMMUTABLE: this credit note is applied and posted to the ledger. It cannot be unapplied, deleted, restored or repriced. Contact support to arrange a reviewed reversal of the posted credit before issuing a replacement credit note.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_prevent_applied_credit_note_mutation ON public.credit_notes;
CREATE TRIGGER trigger_prevent_applied_credit_note_mutation
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_applied_credit_note_mutation();
