import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveServiceBusinessSubscriptionFromUserMetadata } from "@/lib/auth/resolveServiceBusinessSubscription"
import { sendServiceWelcomeNotificationsAfterProvision } from "@/lib/auth/sendServiceWelcomeNotification"

const BodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address_country: z.string().trim().min(1).max(120).nullable().optional(),
  default_currency: z.string().trim().min(1).max(16),
  start_date: z.string().trim().max(32).nullable().optional(),
})

/**
 * POST /api/auth/provision-service-business
 *
 * Idempotent first-time setup for public signups: creates a single **service**
 * industry business for the authenticated user. Ignores any workspace / industry
 * fields if ever added to the body — subscription fields are derived only from
 * Auth user_metadata on the server.
 *
 * Welcome / customer-success emails are sent after a **new** business is created
 * (including Google sign-in users who complete business-setup and POST here).
 * They are not sent when `alreadyExists: true`.
 */
export async function POST(request: NextRequest) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: existing } = await supabase
    .from("businesses")
    .select("id, name, industry, onboarding_step")
    .eq("owner_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyExists: true,
      business: existing,
    })
  }

  const sub = resolveServiceBusinessSubscriptionFromUserMetadata(
    user.user_metadata as Record<string, unknown>
  )

  const body = parsed.data
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({
      owner_id: user.id,
      name: body.name,
      industry: "service",
      address_country: body.address_country ?? null,
      default_currency: body.default_currency,
      start_date: body.start_date || null,
      onboarding_step: "business_profile",
      ...sub,
    })
    .select("id, name, industry, created_at, start_date, onboarding_step")
    .single()

  if (businessError) {
    console.error("[provision-service-business] insert business:", businessError)
    return NextResponse.json({ error: businessError.message || "Could not create business" }, { status: 500 })
  }

  const { error: linkError } = await supabase.from("business_users").insert({
    business_id: business.id,
    user_id: user.id,
    role: "admin",
  })

  if (linkError) {
    console.error("[provision-service-business] business_users:", linkError)
    return NextResponse.json({ error: linkError.message || "Could not link user to business" }, { status: 500 })
  }

  void sendServiceWelcomeNotificationsAfterProvision({
    businessId: business.id as string,
    ownerUserId: user.id,
  }).catch((err) => {
    console.error("[provision-service-business] welcome notifications:", err)
  })

  return NextResponse.json({
    ok: true,
    alreadyExists: false,
    business,
  })
}
