import { AccountingClientContextGate } from "@/components/AccountingClientContextGate"
import PermissionVisibilityBanner from "@/components/accounting/PermissionVisibilityBanner"
import ServiceOwnerAccountingBanner from "@/components/accounting/ServiceOwnerAccountingBanner"

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AccountingClientContextGate>
      <PermissionVisibilityBanner />
      <ServiceOwnerAccountingBanner />
      {children}
    </AccountingClientContextGate>
  )
}
