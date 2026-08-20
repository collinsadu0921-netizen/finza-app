import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

/**
 * GET /api/accounting/firm/firms
 * 
 * Returns list of firms the user belongs to with their role in each firm
 * 
 * Access: Users who belong to accounting firms
 */
export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const diag = createRouteDiag("firm_firms")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    diag.recordTiming("auth", timedStepMs(tAuth), "session")

    if (!user) {
      return respond({ error: "Unauthorized" }, 401)
    }

    const tMember = performance.now()
    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    diag.recordTiming("membership", timedStepMs(tMember))
    if (forbidden) return forbidden

    const tDb = performance.now()
    // Get user's firms with their role
    const { data: firmUsers, error: firmUsersError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, role")
      .eq("user_id", user.id)

    if (firmUsersError) {
      console.error("Error fetching user firms:", firmUsersError)
      return respond({ error: "Failed to fetch firm membership" }, 500)
    }

    if (!firmUsers || firmUsers.length === 0) {
      diag.recordTiming("db", timedStepMs(tDb))
      return respond({ firms: [] }, 200)
    }

    const firmIds = firmUsers.map((fu) => fu.firm_id)

    // Get firm details
    const { data: firms, error: firmsError } = await supabase
      .from("accounting_firms")
      .select("id, name")
      .in("id", firmIds)

    if (firmsError) {
      console.error("Error fetching firms:", firmsError)
      return respond({ error: "Failed to fetch firms" }, 500)
    }
    diag.recordTiming("db", timedStepMs(tDb))

    // Combine firm info with user role
    const firmsWithRole = (firms || []).map((firm) => {
      const firmUser = firmUsers.find((fu) => fu.firm_id === firm.id)
      return {
        firm_id: firm.id,
        firm_name: firm.name,
        role: firmUser?.role || null,
      }
    })

    return respond({
      firms: firmsWithRole,
    }, 200)
  } catch (error: unknown) {
    console.error("Error in firm firms API:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}
