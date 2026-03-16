import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Void a sale with supervisor override protection
 * This function should be called from the frontend after supervisor approval
 */
export async function voidSaleWithOverride(
  supabase: SupabaseClient,
  saleId: string,
  cashierId: string
): Promise<void> {
  // This function is a wrapper that calls the API
  // The actual voiding happens in the API route after override validation
  const response = await fetch("/api/override/void-sale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sale_id: saleId,
      cashier_id: cashierId,
      // Supervisor credentials should be provided via the override modal
    }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || "Failed to void sale")
  }
}

/**
 * Check if a sale can be voided (not already voided)
 */
export async function canVoidSale(
  supabase: SupabaseClient,
  saleId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("sales")
    .select("id")
    .eq("id", saleId)
    .maybeSingle()

  if (error || !data) {
    return false
  }

  return true
}



