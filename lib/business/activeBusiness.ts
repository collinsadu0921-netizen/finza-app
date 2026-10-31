/**
 * Shared workspace-context constants. Safe for client and server imports.
 */

export const ACTIVE_BUSINESS_COOKIE = "finza_active_business_id"

export const WORKSPACE_CONTEXT_REQUIRED_CODE = "WORKSPACE_CONTEXT_REQUIRED"
export const WORKSPACE_CONTEXT_MISMATCH_CODE = "WORKSPACE_CONTEXT_MISMATCH"

export const WORKSPACE_CONTEXT_REQUIRED_MESSAGE =
  "Select a workspace before performing this financial operation."

export const WORKSPACE_CONTEXT_MISMATCH_MESSAGE =
  "The active workspace changed in another tab. Refresh before making changes."
