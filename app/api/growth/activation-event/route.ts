import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import {
  isBusinessActivationEventName,
  type BusinessActivationEventName,
} from "@/lib/growth/activationEvents"
import { recordBusinessActivationEvent } from "@/lib/growth/recordBusinessActivationEvent"

const BodySchema = z.object({
  business_id: z.string().uuid().optional(),
  event_name: z.string().trim().min(1).max(64),
  metadata: z.record(z.unknown()).optional(),
})

/**
 * POST /api/growth/activation-event
 * Records a deduped activation milestone for the authenticated user's business.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await request.json()
    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }

    const eventName = parsed.data.event_name as BusinessActivationEventName
    if (!isBusinessActivationEventName(eventName)) {
      return NextResponse.json({ error: "Invalid event_name" }, { status: 400 })
    }

    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      parsed.data.business_id ?? null
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const result = await recordBusinessActivationEvent(supabase, {
      businessId: scope.businessId,
      eventName,
      metadata: parsed.data.metadata,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      recorded: result.recorded === true,
      duplicate: result.recorded === false && result.reason === "duplicate",
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
