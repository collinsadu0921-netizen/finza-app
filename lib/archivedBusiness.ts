import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Throws "Business is archived" if the business has archived_at set.
 * Use at accounting mutation entrypoints (invoice, payment, expense, sale, journal post).
 */
export async function assertBusinessNotArchived(
  supabase: SupabaseClient,
  businessId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, archived_at")
    .eq("id", businessId)
    .single()

  if (error || !data) {
    return
  }

  if (data.archived_at != null) {
    throw new Error("Business is archived")
  }
}
