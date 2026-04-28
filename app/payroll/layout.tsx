"use client"

import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Auth shell for standalone `/payroll/*`.
 * Service payroll uses `app/service/payroll/layout.tsx` (tier gate + `/service/payroll` base path).
 */
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>
}
