import AccountingWorkspaceShell from "@/components/accounting/AccountingWorkspaceShell"
import ProtectedLayout from "@/components/ProtectedLayout"

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ProtectedLayout>
      <AccountingWorkspaceShell>{children}</AccountingWorkspaceShell>
    </ProtectedLayout>
  )
}
