import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { PROPOSAL_ASSETS_BUCKET } from "./storageConstants"

export type ProposalUploadCleanupResult = {
  scanned: number
  deleted: number
  storageRemoved: number
}

/**
 * Remove abandoned pending uploads. A pending row is created before the browser
 * uploads directly to Storage; if the browser never calls finalize, both the
 * row and its private object are removed after the TTL.
 */
export async function cleanupExpiredProposalUploads(options?: {
  businessId?: string
  proposalId?: string
  olderThanMinutes?: number
  limit?: number
}): Promise<ProposalUploadCleanupResult> {
  const admin = getSupabaseServiceRoleClient()
  if (!admin) return { scanned: 0, deleted: 0, storageRemoved: 0 }

  const olderThanMinutes = Math.max(1, options?.olderThanMinutes ?? 120)
  const limit = Math.min(500, Math.max(1, options?.limit ?? 100))
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

  let query = admin
    .from("proposal_assets")
    .select("id, business_id, proposal_id, storage_path")
    .eq("upload_state", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (options?.businessId) query = query.eq("business_id", options.businessId)
  if (options?.proposalId) query = query.eq("proposal_id", options.proposalId)

  const { data: rows, error } = await query
  if (error || !rows?.length) {
    if (error) console.error("proposal upload cleanup query:", error)
    return { scanned: 0, deleted: 0, storageRemoved: 0 }
  }

  let storageRemoved = 0
  const removedIds: string[] = []

  for (const row of rows) {
    if (row.storage_path) {
      const { error: storageError } = await admin.storage
        .from(PROPOSAL_ASSETS_BUCKET)
        .remove([row.storage_path as string])
      if (!storageError) storageRemoved += 1
    }
    removedIds.push(row.id as string)
  }

  let deleted = 0
  if (removedIds.length) {
    const { error: deleteError, count } = await admin
      .from("proposal_assets")
      .delete({ count: "exact" })
      .in("id", removedIds)
      .eq("upload_state", "pending")
    if (deleteError) {
      console.error("proposal upload cleanup delete:", deleteError)
    } else {
      deleted = count ?? removedIds.length
    }
  }

  return { scanned: rows.length, deleted, storageRemoved }
}
