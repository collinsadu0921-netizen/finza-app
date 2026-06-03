"use client"

import { useCallback } from "react"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import { buildServiceRoute } from "@/lib/service/routes"

export type ServiceFinancialWriteScope =
  | "default"
  | "expenses"
  | "invoices"
  | "payments"
  | "bills"
  | "payroll"
  | "proforma"
  | "creditNotes"
  | "accounting"
  | "estimates"
  | "recurring"

const MESSAGES: Record<ServiceFinancialWriteScope, string> = {
  default:
    "This workspace is read-only. Upgrade to continue creating or editing financial records.",
  expenses: "This workspace is read-only. Upgrade to add or edit expenses.",
  invoices: "This workspace is read-only. Upgrade to add or edit invoices.",
  payments: "This workspace is read-only. Upgrade to record payments.",
  bills: "This workspace is read-only. Upgrade to add or edit bills.",
  payroll: "This workspace is read-only. Upgrade to add or edit payroll records.",
  proforma: "This workspace is read-only. Upgrade to add or edit proforma invoices.",
  creditNotes: "This workspace is read-only. Upgrade to add or edit credit notes.",
  accounting: "This workspace is read-only. Upgrade to make accounting changes.",
  estimates: "This workspace is read-only. Upgrade to add or edit quotes.",
  recurring: "This workspace is read-only. Upgrade to add or edit recurring invoices.",
}

export function useServiceFinancialWrite(scope: ServiceFinancialWriteScope = "default") {
  const subscription = useServiceSubscription()
  const {
    canWriteFinancialRecords,
    entitlementResolved,
    businessId,
    subscriptionLocked,
  } = subscription

  const readOnly = entitlementResolved && !canWriteFinancialRecords
  const message = MESSAGES[scope]
  const upgradeHref = buildServiceRoute(
    "/service/settings/subscription",
    businessId ?? undefined
  )

  const guardWriteAction = useCallback(
    (action: () => void): boolean => {
      if (readOnly) return false
      action()
      return true
    },
    [readOnly]
  )

  return {
    ...subscription,
    canWrite: canWriteFinancialRecords,
    readOnly,
    message,
    upgradeHref,
    guardWriteAction,
    subscriptionLocked,
  }
}

export { MESSAGES as SERVICE_FINANCIAL_READ_ONLY_MESSAGES }
