import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"
import { getCurrentBusiness } from "@/lib/business"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get business for the user
    const business = await getCurrentBusiness(supabase, user.id)
    
    if (business) {
      // Log login event
      await createAuditLog({
        businessId: business.id,
        userId: user.id,
        actionType: "auth.login",
        entityType: "user",
        entityId: user.id,
        oldValues: null,
        newValues: { user: user.email },
        request,
        description: `User ${user.email} logged in`,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error logging login:", error)
    // Don't fail login if audit logging fails
    return NextResponse.json({ success: true })
  }
}

