/** UI helpers for draft payroll run deletion (client-safe). */

export const PAYROLL_DRAFT_DELETE_CONFIRM = {
  title: "Delete draft payroll?",
  description:
    "This will remove the draft payroll run and its draft entries. It will not affect your accounting records.",
  confirmLabel: "Delete draft",
} as const

/** Show delete only for draft runs; API enforces journal/payment guards. */
export function canShowPayrollDraftDelete(status: string | null | undefined): boolean {
  return status === "draft"
}

export async function requestDeleteDraftPayrollRun(
  runId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(`/api/payroll/runs/${runId}`, { method: "DELETE" })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    return { ok: false, error: data.error || "Could not delete draft payroll run" }
  }
  return { ok: true }
}
