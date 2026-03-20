-- ============================================================================
-- Migration 361: Add custom_permissions column to business_users
-- ============================================================================
-- Enables owner/admin to grant or revoke individual permissions for any team
-- member, independent of their role.
--
-- Structure:
--   custom_permissions = {
--     "granted": ["payroll.lock", ...],   -- add on top of role defaults
--     "revoked": ["payroll.approve", ...] -- remove from role defaults
--   }
--
-- Effective permissions = ROLE_DEFAULTS[role] + granted − revoked
-- Owners always have all permissions regardless of this field.
-- ============================================================================

ALTER TABLE business_users
  ADD COLUMN IF NOT EXISTS custom_permissions JSONB
    NOT NULL DEFAULT '{"granted": [], "revoked": []}'::jsonb;

COMMENT ON COLUMN business_users.custom_permissions IS
'Per-user permission overrides. {"granted": [...], "revoked": [...]}
 Effective = role_defaults + granted − revoked. Owner ignores this field.';
