import "server-only"

import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalOpsAdmin } from "@/lib/internalAnnouncementsAdmin"

export async function requireInternalOps(): Promise<
  | { ok: true; user: User; admin: SupabaseClient; requestId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!isInternalOpsAdmin(user)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Server misconfigured" }, { status: 500 }),
    }
  }
  return { ok: true, user, admin, requestId: crypto.randomUUID() }
}
