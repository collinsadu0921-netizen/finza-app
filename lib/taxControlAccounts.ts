/**
 * Helper functions for resolving tax control accounts
 * Uses chart_of_accounts_control_map to resolve control keys to account codes
 */

import { SupabaseClient } from "@supabase/supabase-js"

export interface TaxControlAccountCodes {
  vat: string | null
  nhil: string | null
  getfund: string | null
  covid: string | null
}

/**
 * Resolve tax control account codes from chart_of_accounts_control_map
 * Returns account codes for VAT_PAYABLE, NHIL_PAYABLE, GETFUND_PAYABLE, COVID_PAYABLE
 */
export async function getTaxControlAccountCodes(
  supabase: SupabaseClient,
  businessId: string
): Promise<TaxControlAccountCodes> {
  // Get control account mappings
  const { data: controlMappings, error } = await supabase
    .from("chart_of_accounts_control_map")
    .select("control_key, account_code")
    .eq("business_id", businessId)
    .in("control_key", ["VAT_PAYABLE", "NHIL_PAYABLE", "GETFUND_PAYABLE", "COVID_PAYABLE"])

  if (error) {
    console.error("Error fetching tax control account mappings:", error)
    throw new Error("Failed to fetch tax control account mappings")
  }

  // Build map of control_key -> account_code
  const codeMap: Record<string, string> = {}
  controlMappings?.forEach((mapping) => {
    codeMap[mapping.control_key] = mapping.account_code
  })

  // Validate that mapped accounts exist and are active
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

    // Check all accounts are active
    const activeAccountCodes = new Set(
      accounts?.filter((acc) => acc.is_active).map((acc) => acc.account_code) || []
    )

    // Remove inactive accounts from codeMap
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





