"use client"

/**
 * Wave 5: Pass-through only. URL business_id is the only client source; pages show EmptyState when missing.
 */

export function AccountingClientContextGate({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
