"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import AccountingWorkspaceShell from "@/components/accounting/AccountingWorkspaceShell"
import ProtectedLayout from "@/components/ProtectedLayout"

/**
 * Invitation accept must render without firm-shell / membership gate so
 * logged-out and not-yet-member invitees can see Sign in / Create account.
 */
export default function AccountingLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isInvitationAccept =
    pathname === "/accounting/invitations/accept" ||
    pathname?.startsWith("/accounting/invitations/accept/")

  if (isInvitationAccept) {
    return <>{children}</>
  }

  return (
    <ProtectedLayout>
      <AccountingWorkspaceShell>{children}</AccountingWorkspaceShell>
    </ProtectedLayout>
  )
}
