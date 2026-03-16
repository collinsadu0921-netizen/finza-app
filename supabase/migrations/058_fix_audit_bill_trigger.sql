-- Fix audit_bill_changes() function to properly declare business_id_val and bill_id_val
-- This fixes the "column business_id_val does not exist" error

CREATE OR REPLACE FUNCTION audit_bill_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  business_id_val UUID;
  bill_id_val UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_type_val := 'bill.created';
    old_json := NULL;
    new_json := to_jsonb(NEW);
    business_id_val := NEW.business_id;
    bill_id_val := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      action_type_val := 'bill.status_changed';
    ELSE
      action_type_val := 'bill.edited';
    END IF;
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    business_id_val := NEW.business_id;
    bill_id_val := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'bill.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
    business_id_val := OLD.business_id;
    bill_id_val := OLD.id;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'bill',
    bill_id_val,
    old_json,
    new_json
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

