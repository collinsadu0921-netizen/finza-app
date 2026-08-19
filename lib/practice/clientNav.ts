/**
 * Client layout tabs for Practice client command center.
 * Notes live on Overview — there is no standalone /notes page.
 */
export const PRACTICE_CLIENT_NAV_TABS = [
  { label: "Overview", segment: "overview" },
  { label: "Tasks", segment: "tasks" },
  { label: "Requests", segment: "requests" },
  { label: "Filings", segment: "filings" },
  { label: "VAT", segment: "vat" },
  { label: "Periods", segment: "periods" },
  { label: "Adjustments", segment: "adjustments" },
  { label: "Documents", segment: "documents" },
] as const

export function practiceClientNavHasNotesTab(): boolean {
  return (PRACTICE_CLIENT_NAV_TABS as readonly { segment: string }[]).some(
    (tab) => tab.segment === "notes"
  )
}
