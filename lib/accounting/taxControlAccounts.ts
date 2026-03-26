import type { SupabaseClient } from "@supabase/supabase-js"

export interface TaxControlAccountCodes {
  vat: string | null
  nhil: string | null
  getfund: string | null
  covid: string | null
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
    .in("control_key", ["VAT_PAYABLE", "NHIL_PAYABLE", "GETFUND_PAYABLE", "COVID_PAYABLE"])

  if (error) {
    console.error("Error fetching tax control account mappings:", error)
    throw new Error("Failed to fetch tax control account mappings")
  }

  const codeMap: Record<string, string> = {}
  controlMappings?.forEach((mapping) => {
    codeMap[mapping.control_key] = mapping.account_code
  })

  const accountCodes = Object.values(codeMap).filter(Boolean)
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

    Object.keys(codeMap).forEach((key) => {
      if (!activeAccountCodes.has(codeMap[key])) {
        delete codeMap[key]
      }
    })
  }

  return {
    vat: codeMap["VAT_PAYABLE"] || null,
    nhil: codeMap["NHIL_PAYABLE"] || null,
    getfund: codeMap["GETFUND_PAYABLE"] || null,
    covid: codeMap["COVID_PAYABLE"] || null,
  }
}
