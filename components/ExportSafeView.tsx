"use client"

import { useExportMode } from "@/lib/hooks/useExportMode"

/**
 * When isExportMode (e.g. ?print=true, /preview/*, /export/*):
 * Renders ONLY children — no layout chrome. Use to wrap sidebar/nav so they
 * are not rendered in export/preview/print.
 *
 * When not export mode: Renders chrome (if provided) then children.
 *
 * Usage in layout:
 *   <ExportSafeView chrome={<><Sidebar /><TopNav /></>}>
 *     <main>{children}</main>
 *   </ExportSafeView>
 *
 * GUARDRAIL: UI controls (buttons, toolbars, filters, nav) MUST include
 * the .export-hide or .print-hide class so they do not appear in preview,
 * export, or print output. See globals.css and lib/exportMode.ts.
 */
export default function ExportSafeView({
  children,
  chrome,
}: {
  children: React.ReactNode
  chrome?: React.ReactNode
}) {
  const isExportMode = useExportMode()
  if (isExportMode) return <>{children}</>
  return (
    <>
      {chrome}
      {children}
    </>
  )
}
