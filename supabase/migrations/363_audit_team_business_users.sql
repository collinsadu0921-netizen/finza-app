-- Audit trigger for business_users table
-- Captures: member invited, role changed, permissions updated, member removed.
-- This is a DB-level safety net; the application also logs these via logAudit().

CREATE OR REPLACE FUNCTION audit_business_user_changes()
RETURNS TRIGGER AS $$
DECLARE
  action_type_val TEXT;
  old_json        JSONB;
  new_json        JSONB;
  changed         JSONB;
  biz_id          UUID;
  record_id       UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    biz_id    := OLD.business_id;
    record_id := OLD.id;
  ELSE
    biz_id    := NEW.business_id;
    record_id := NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type_val := 'team.member_invited';
    old_json        := NULL;
    new_json        := jsonb_build_object(
      'user_id',      NEW.user_id,
      'role',         NEW.role,
      'email',        NEW.email,
      'display_name', NEW.display_name,
      'invited_by',   NEW.invited_by
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine what changed
    IF OLD.role IS DISTINCT FROM NEW.role AND OLD.custom_permissions IS NOT DISTINCT FROM NEW.custom_permissions THEN
      action_type_val := 'team.member_role_changed';
    ELSIF OLD.custom_permissions IS DISTINCT FROM NEW.custom_permissions AND OLD.role IS NOT DISTINCT FROM NEW.role THEN
      action_type_val := 'team.member_permissions_updated';
    ELSE
      action_type_val := 'team.member_updated';
    END IF;

    old_json := jsonb_build_object(
      'role',               OLD.role,
      'custom_permissions', OLD.custom_permissions
    );
    new_json := jsonb_build_object(
      'role',               NEW.role,
      'custom_permissions', NEW.custom_permissions
    );

  ELSIF TG_OP = 'DELETE' THEN
    action_type_val := 'team.member_removed';
    old_json        := jsonb_build_object(
      'user_id',      OLD.user_id,
      'role',         OLD.role,
      'email',        OLD.email,
      'display_name', OLD.display_name
    );
    new_json        := NULL;
  END IF;

  PERFORM create_audit_log(
    biz_id,
    auth.uid(),
    action_type_val,
    'team_member',
    record_id,
    old_json,
    new_json,
    NULL,
    NULL,
    NULL
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_users'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_audit_business_user ON business_users;
    CREATE TRIGGER trigger_audit_business_user
      AFTER INSERT OR UPDATE OR DELETE ON business_users
      FOR EACH ROW
      EXECUTE FUNCTION audit_business_user_changes();
  END IF;
END $$;
