/** @jest-environment node */

import { getCurrencySymbol } from "@/lib/currency"
import { formatMoney, formatMoneyWithCode } from "@/lib/money"
import type { WorkspaceBusiness } from "@/components/WorkspaceBusinessContext"

export function syncBusinessCurrencyFromRow(business: WorkspaceBusiness): {
  businessId: string | null
  currencyCode: string | null
  currencySymbol: string | null
} {
  if (!business?.id) {
    return { businessId: null, currencyCode: null, currencySymbol: null }
  }
  const code = business.default_currency || null
  return {
    businessId: business.id,
    currencyCode: code,
    currencySymbol: code ? getCurrencySymbol(code) : null,
  }
}

export function formatBusinessCurrencyAmount(
  amount: number | null | undefined,
  currencyCode: string | null
): string {
  return formatMoney(amount, currencyCode)
}

export function formatBusinessCurrencyAmountWithCode(
  amount: number | null | undefined,
  currencyCode: string | null
): string {
  return formatMoneyWithCode(amount, currencyCode)
}
