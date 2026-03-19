/**
 * Supabase Admin (service-role) client.
 * Bypasses RLS — only use in server-side code for trusted operations.
 * NEVER expose to the client.
 */

import { createClient } from "@supabase/supabase-js"

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
