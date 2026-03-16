import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Account Eligibility for Opening Balances
 * 
 * Phase 2B: Safety hooks for future opening balances phase
 * 
 * Eligibility Rules (CANONICAL - LOCK THIS):
 * - Allowed: asset, liability, equity
 * - Forbidden: income, expense
 * - Forbidden: System accounts (is_system = true)
 * - Forbidden: AR/AP control accounts (identified by code 1100, 2000)
 * - Forbidden: Tax system accounts (VAT, NHIL, GETFund, COVID Levy, etc.)
 * 
 * This validation MUST be enforced server-side for security.
 * Client-side filtering is for UX only.
 */

type AccountType = "asset" | "liability" | "equity" | "income" | "expense"

/**
 * Allowed account types for opening balances
 */
const ALLOWED_TYPES: AccountType[] = ["asset", "liability", "equity"]

/**
 * Forbidden account types for opening balances
 */
const FORBIDDEN_TYPES: AccountType[] = ["income", "expense"]

/**
 * System account codes that are forbidden for opening balances
 * These include AR/AP control accounts and tax system accounts
 */
const FORBIDDEN_SYSTEM_CODES = [
  "1100", // Accounts Receivable (AR control)
  "2000", // Accounts Payable (AP control)
  "2100", // VAT Payable
  "2110", // NHIL Payable
  "2120", // GETFund Payable
  "2130", // COVID Levy Payable
  "2200", // Other Tax Liabilities
  "2210", // PAYE Liability
  "2220", // SSNIT Employee Contribution Payable
  "2230", // SSNIT Employer Contribution Payable
  "2240", // Net Salaries Payable
]

/**
 * Assert that an account is eligible for opening balances
 * 
 * This function validates account eligibility server-side.
 * Throws an error if the account is not eligible.
 * 
 * @param supabase - Supabase client
 * @param accountId - Account ID to validate
 * @param businessId - Business ID (for context)
 * @throws Error if account is not eligible
 */
export async function assertAccountEligibleForOpeningBalance(
  supabase: SupabaseClient,
  accountId: string,
  businessId: string
): Promise<void> {
  // Fetch account
  const { data: account, error } = await supabase
    .from("accounts")
    .select("id, code, name, type, is_system")
    .eq("id", accountId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()

  if (error || !account) {
    throw new Error(`Account not found: ${accountId}`)
  }

  // Check account type
  if (FORBIDDEN_TYPES.includes(account.type as AccountType)) {
    throw new Error(
      `Account ${account.code} (${account.name}) is of type '${account.type}' and cannot be used for opening balances. Only asset, liability, and equity accounts are allowed.`
    )
  }

  if (!ALLOWED_TYPES.includes(account.type as AccountType)) {
    throw new Error(
      `Account ${account.code} (${account.name}) has invalid type '${account.type}'. Only asset, liability, and equity accounts are allowed.`
    )
  }

  // Check if system account
  if (account.is_system) {
    // Check if it's a forbidden system account code
    if (FORBIDDEN_SYSTEM_CODES.includes(account.code)) {
      throw new Error(
        `Account ${account.code} (${account.name}) is a system control account and cannot be used for opening balances.`
      )
    }

    // All system accounts are forbidden (even if not in forbidden list)
    throw new Error(
      `Account ${account.code} (${account.name}) is a system account and cannot be used for opening balances. Only non-system accounts are allowed.`
    )
  }

  // Account is eligible
  return
}

/**
 * Check if an account is eligible for opening balances (returns boolean)
 * 
 * This is a non-throwing version of assertAccountEligibleForOpeningBalance
 * Useful for client-side validation or filtering.
 * 
 * @param supabase - Supabase client
 * @param accountId - Account ID to validate
 * @param businessId - Business ID (for context)
 * @returns Promise<boolean> - true if eligible, false otherwise
 */
export async function isAccountEligibleForOpeningBalance(
  supabase: SupabaseClient,
  accountId: string,
  businessId: string
): Promise<boolean> {
  try {
    await assertAccountEligibleForOpeningBalance(supabase, accountId, businessId)
    return true
  } catch {
    return false
  }
}

/**
 * Get eligibility rules (for documentation/UI display)
 */
export function getAccountEligibilityRules() {
  return {
    allowedTypes: ALLOWED_TYPES,
    forbiddenTypes: FORBIDDEN_TYPES,
    forbiddenSystemCodes: FORBIDDEN_SYSTEM_CODES,
    rules: {
      allowed: [
        "Account type must be: asset, liability, or equity",
        "Account must NOT be a system account (is_system = false)",
        "Account must NOT be an AR/AP control account (codes 1100, 2000)",
        "Account must NOT be a tax system account (VAT, NHIL, GETFund, etc.)",
      ],
      forbidden: [
        "Income accounts",
        "Expense accounts",
        "System accounts (is_system = true)",
        "AR/AP control accounts",
        "Tax system accounts",
      ],
    },
  }
}
