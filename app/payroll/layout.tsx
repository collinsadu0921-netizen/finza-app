"use client"

import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Auth shell for /payroll/* only. /service/payroll/* uses service layout.
 */
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>
}
