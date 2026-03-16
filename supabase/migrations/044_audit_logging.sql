-- Migration: Audit Logging System
-- Comprehensive audit trail for all business operations

-- ============================================================================
-- AUDIT_LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created ON audit_logs(business_id, created_at DESC);

-- ============================================================================
-- FUNCTION: Create audit log entry
-- ============================================================================
CREATE OR REPLACE FUNCTION create_audit_log(
  p_business_id UUID,
  p_user_id UUID,
  p_action_type TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO audit_logs (
    business_id,
    user_id,
    action_type,
    entity_type,
    entity_id,
    old_values,
    new_values,
    ip_address,
    user_agent,
    description
  ) VALUES (
    p_business_id,
    p_user_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_old_values,
    p_new_values,
    p_ip_address,
    p_user_agent,
    p_description
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Get changed fields between old and new records
-- ============================================================================
CREATE OR REPLACE FUNCTION get_changed_fields(old_record JSONB, new_record JSONB)
RETURNS JSONB AS $$
DECLARE
  old_changed JSONB := '{}'::JSONB;
  new_changed JSONB := '{}'::JSONB;
  key TEXT;
BEGIN
  -- Compare all keys in new_record
  FOR key IN SELECT jsonb_object_keys(new_record)
  LOOP
    IF old_record IS NULL OR old_record->>key IS DISTINCT FROM new_record->>key THEN
      IF old_record IS NOT NULL AND old_record ? key THEN
        old_changed := old_changed || jsonb_build_object(key, old_record->key);
      END IF;
      new_changed := new_changed || jsonb_build_object(key, new_record->key);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('old', old_changed, 'new', new_changed);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS: Invoice Audit Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_invoice_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  changed JSONB;
  business_id_val UUID;
  invoice_id_val UUID;
BEGIN
  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    invoice_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    invoice_id_val := NEW.id;
  END IF;

  -- Determine action type
  IF TG_OP = 'INSERT' THEN
    action_type_val := 'invoice.created';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if status changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      action_type_val := 'invoice.status_changed';
    ELSE
      action_type_val := 'invoice.edited';
    END IF;
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    changed := get_changed_fields(old_json, new_json);
    old_json := changed->'old';
    new_json := changed->'new';
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'invoice.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  -- Create audit log
  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'invoice',
    invoice_id_val,
    old_json,
    new_json,
    NULL, -- IP address (set from application)
    NULL, -- User agent (set from application)
    CASE 
      WHEN TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status 
      THEN 'Status changed from ' || OLD.status || ' to ' || NEW.status
      ELSE NULL
    END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if invoices table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'invoices'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_invoice ON invoices;
    CREATE TRIGGER trigger_audit_invoice
      AFTER INSERT OR UPDATE OR DELETE ON invoices
      FOR EACH ROW
      EXECUTE FUNCTION audit_invoice_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Payment Audit Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_payment_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  changed JSONB;
  business_id_val UUID;
  payment_id_val UUID;
BEGIN
  -- Skip if soft-deleted (for INSERT/UPDATE)
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    payment_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    payment_id_val := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'payment.added';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type_val := 'payment.edited';
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
    changed := get_changed_fields(old_json, new_json);
    old_json := changed->'old';
    new_json := changed->'new';
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'payment.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'payment',
    payment_id_val,
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

-- Only create trigger if payments table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'payments'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_payment ON payments;
    CREATE TRIGGER trigger_audit_payment
      AFTER INSERT OR UPDATE OR DELETE ON payments
      FOR EACH ROW
      EXECUTE FUNCTION audit_payment_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Credit Note Audit Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_credit_note_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  business_id_val UUID;
  credit_note_id_val UUID;
BEGIN
  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    credit_note_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    credit_note_id_val := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'credit_note.created';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'applied' THEN
      action_type_val := 'credit_note.applied';
    ELSE
      action_type_val := 'credit_note.edited';
    END IF;
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'credit_note.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'credit_note',
    credit_note_id_val,
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

-- Only create trigger if credit_notes table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'credit_notes'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_credit_note ON credit_notes;
    CREATE TRIGGER trigger_audit_credit_note
      AFTER INSERT OR UPDATE OR DELETE ON credit_notes
      FOR EACH ROW
      EXECUTE FUNCTION audit_credit_note_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Expense Audit Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_expense_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  business_id_val UUID;
  expense_id_val UUID;
BEGIN
  -- Skip if soft-deleted (for INSERT/UPDATE)
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    expense_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    expense_id_val := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'expense.created';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type_val := 'expense.edited';
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'expense.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'expense',
    expense_id_val,
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

-- Only create trigger if expenses table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'expenses'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_expense ON expenses;
    CREATE TRIGGER trigger_audit_expense
      AFTER INSERT OR UPDATE OR DELETE ON expenses
      FOR EACH ROW
      EXECUTE FUNCTION audit_expense_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Bill Audit Logging
-- ============================================================================

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

-- Only create trigger if bills table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'bills'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_bill ON bills;
    CREATE TRIGGER trigger_audit_bill
      AFTER INSERT OR UPDATE OR DELETE ON bills
      FOR EACH ROW
      EXECUTE FUNCTION audit_bill_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Bill Payment Audit Logging
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_bill_payment_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  business_id_val UUID;
  payment_id_val UUID;
BEGIN
  -- Skip if soft-deleted (for INSERT/UPDATE)
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    payment_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    payment_id_val := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'bill_payment.added';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type_val := 'bill_payment.edited';
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'bill_payment.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'bill_payment',
    payment_id_val,
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

-- Only create trigger if bill_payments table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'bill_payments'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_bill_payment ON bill_payments;
    CREATE TRIGGER trigger_audit_bill_payment
      AFTER INSERT OR UPDATE OR DELETE ON bill_payments
      FOR EACH ROW
      EXECUTE FUNCTION audit_bill_payment_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Account Audit Logging (Chart of Accounts)
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_account_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
  business_id_val UUID;
  account_id_val UUID;
BEGIN
  -- Skip if soft-deleted (for INSERT/UPDATE)
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Get business_id and id based on operation
  IF TG_OP = 'DELETE' THEN
    business_id_val := OLD.business_id;
    account_id_val := OLD.id;
  ELSE
    business_id_val := NEW.business_id;
    account_id_val := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'account.created';
    old_json := NULL;
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    action_type_val := 'account.edited';
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'account.deleted';
    old_json := to_jsonb(OLD);
    new_json := NULL;
  END IF;

  PERFORM create_audit_log(
    business_id_val,
    auth.uid(),
    action_type_val,
    'account',
    account_id_val,
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

-- Only create trigger if accounts table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'accounts'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_account ON accounts;
    CREATE TRIGGER trigger_audit_account
      AFTER INSERT OR UPDATE OR DELETE ON accounts
      FOR EACH ROW
      EXECUTE FUNCTION audit_account_changes();
  END IF;
END $$;

-- ============================================================================
-- TRIGGERS: Journal Entry Audit Logging (for manual entries)
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_journal_entry_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json JSONB;
  new_json JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only log manual entries, not auto-posted ones
    IF NEW.reference_type = 'manual' THEN
      action_type_val := 'journal_entry.created';
      old_json := NULL;
      new_json := to_jsonb(NEW);
      
      PERFORM create_audit_log(
        NEW.business_id,
        NEW.created_by,
        action_type_val,
        'journal_entry',
        NEW.id,
        old_json,
        new_json
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if journal_entries table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'journal_entries'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_journal_entry ON journal_entries;
    CREATE TRIGGER trigger_audit_journal_entry
      AFTER INSERT ON journal_entries
      FOR EACH ROW
      EXECUTE FUNCTION audit_journal_entry_changes();
  END IF;
END $$;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view audit logs for their business"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = audit_logs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Only system can insert audit logs (via triggers and functions)
CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (true);

