"use client"

import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Applies auth shell for /bills/* only. /service/bills uses app/service/layout.tsx
 * so we must not wrap BillsPage in ProtectedLayout again (avoids double lg:pl-64).
 */
export default function BillsLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>
}
