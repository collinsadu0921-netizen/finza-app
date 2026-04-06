import "server-only"

/**
 * **Customer-facing** manual wallet instructions for public invoice / pay flows.
 *
 * This is intentionally separate from `maskProviderConfigForUi` (staff/settings), which masks
 * `wallet_number` for admin lists. Payers need the full number to complete a transfer.
 * Do not use the admin masked DTO on customer pay pages.
 */
import type { ResolvedManualWalletConfig } from "./types"

export type ManualWalletCustomerInstructions = {
  provider_type: "manual_wallet"
  network: string | null
  account_name: string | null
  wallet_number: string | null
  instructions: string | null
  display_label: string | null
}

export function serializeManualWalletForCustomer(
  resolved: ResolvedManualWalletConfig
): ManualWalletCustomerInstructions {
  const p = resolved.public
  return {
    provider_type: "manual_wallet",
    network: p.network ?? null,
    account_name: p.account_name ?? null,
    wallet_number: p.wallet_number ?? null,
    instructions: p.instructions ?? null,
    display_label: p.display_label ?? null,
  }
}
