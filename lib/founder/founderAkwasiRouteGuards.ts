import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isFinzaFounderAccess } from "@/lib/founder/isFinzaFounder"

export async function getFounderAkwasiAuthContext(): Promise<
  | { ok: true; user: User; admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!isFinzaFounderAccess(user)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const admin = getSupabaseServiceRoleClient()
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" },
        { status: 500 }
      ),
    }
  }

  return { ok: true, user, admin }
}
