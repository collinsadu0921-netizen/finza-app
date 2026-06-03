"use client"

import type { ServiceFinancialWriteScope } from "@/components/service/useServiceFinancialWrite"
import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"

type Props = {
  scope?: ServiceFinancialWriteScope
  children: React.ReactNode
}

/** Renders children only when financial writes are allowed. */
export function ServiceFinancialWriteGate({ scope = "default", children }: Props) {
  const { readOnly } = useServiceFinancialWrite(scope)
  if (readOnly) return null
  return <>{children}</>
}
