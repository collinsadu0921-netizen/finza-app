import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Accounting-local copy to avoid cross-namespace import from "@/lib/archivedBusiness".
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
