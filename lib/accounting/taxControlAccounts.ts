import type { SupabaseClient } from "@supabase/supabase-js"

export interface TaxControlAccountCodes {
  vat: string | null
  nhil: string | null
  getfund: string | null
  covid: string | null
}

const TAX_CONTROL_KEYS = [
  "VAT_PAYABLE",
  "NHIL_PAYABLE",
  "GETFUND_PAYABLE",
  "COVID_PAYABLE",
] as const

/**
 * Standard Ghana tax control accounts. These are the same accounts used by
 * VAT filing and payment (2100-2130). They are used only when the business has
 * no explicit control-map row for that key. An explicit mapping always wins;
 * an explicit but inactive mapping is reported as missing rather than silently
 * replaced.
 */
const DEFAULT_TAX_CONTROL_CODES: Record<(typeof TAX_CONTROL_KEYS)[number], string> = {
  VAT_PAYABLE: "2100",
  NHIL_PAYABLE: "2110",
  GETFUND_PAYABLE: "2120",
  COVID_PAYABLE: "2130",
}

/**
 * Accounting-local copy to avoid cross-namespace import from "@/lib/taxControlAccounts".
 */
export async function getTaxControlAccountCodes(
  supabase: SupabaseClient,
  businessId: string
): Promise<TaxControlAccountCodes> {
  const { data: controlMappings, error } = await supabase
    .from("chart_of_accounts_control_map")
    .select("control_key, account_code")
    .eq("business_id", businessId)
    .in("control_key", [...TAX_CONTROL_KEYS])

  if (error) {
    console.error("Error fetching tax control account mappings:", error)
    throw new Error("Failed to fetch tax control account mappings")
  }

  const explicitMap: Record<string, string> = {}
  controlMappings?.forEach((mapping) => {
    explicitMap[mapping.control_key] = mapping.account_code
  })

  // Explicit mappings win. Only keys with no explicit mapping use the
  // standard account fallback.
  const resolvedMap: Record<string, string> = {}
  for (const key of TAX_CONTROL_KEYS) {
    const explicit = explicitMap[key]
    if (explicit) {
      resolvedMap[key] = explicit
    } else {
      resolvedMap[key] = DEFAULT_TAX_CONTROL_CODES[key]
    }
  }

  const accountCodes = Object.values(resolvedMap).filter(Boolean)
  if (accountCodes.length > 0) {
    const { data: accounts, error: accountsError } = await supabase
      .from("chart_of_accounts")
      .select("account_code, is_active")
      .eq("business_id", businessId)
      .in("account_code", accountCodes)

    if (accountsError) {
      console.error("Error validating tax control accounts:", accountsError)
      throw new Error("Failed to validate tax control accounts")
    }

    const activeAccountCodes = new Set(
      accounts?.filter((acc) => acc.is_active).map((acc) => acc.account_code) || []
    )

    Object.keys(resolvedMap).forEach((key) => {
      if (!activeAccountCodes.has(resolvedMap[key])) {
        delete resolvedMap[key]
      }
    })
  }

  return {
    vat: resolvedMap["VAT_PAYABLE"] || null,
    nhil: resolvedMap["NHIL_PAYABLE"] || null,
    getfund: resolvedMap["GETFUND_PAYABLE"] || null,
    covid: resolvedMap["COVID_PAYABLE"] || null,
  }
}
