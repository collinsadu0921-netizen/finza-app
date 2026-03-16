/**
 * Accounting Workspace Context
 * 
 * This constant explicitly identifies the Accounting Workspace context.
 * Used to make workspace authority explicit and prevent accidental reuse
 * by Service workspace.
 * 
 * Purpose:
 * - Makes authority explicit
 * - Prevents accidental reuse by Service workspace later
 * - Provides context for audit logging (future)
 * 
 * Usage:
 * - Import in Accounting API routes
 * - Pass context into Accounting APIs (headers or middleware) - Future
 * - Log workspace context in audit logs (future)
 */

export const WORKSPACE = 'ACCOUNTING' as const

export type AccountingWorkspace = typeof WORKSPACE
