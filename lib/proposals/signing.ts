import type { SupabaseClient } from "@supabase/supabase-js"
import { PROPOSAL_ASSETS_BUCKET } from "./storageConstants"

export async function signProposalAssetPaths(
  supabase: SupabaseClient,
  rows: { id: string; storage_path: string }[],
  expiresSec: number
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (!r.storage_path) continue
    const { data, error } = await supabase.storage.from(PROPOSAL_ASSETS_BUCKET).createSignedUrl(r.storage_path, expiresSec)
    if (!error && data?.signedUrl) {
      out[r.id] = data.signedUrl
    }
  }
  return out
}
