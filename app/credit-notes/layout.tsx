"use client"

import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Auth shell for /credit-notes/* only. /service/credit-notes uses service layout.
 */
export default function CreditNotesLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>
}
