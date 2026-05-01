import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceBusinessSubscriptionFromUserMetadata } from "@/lib/auth/resolveServiceBusinessSubscription"
import { sendServiceWelcomeNotificationsAfterProvision } from "@/lib/auth/sendServiceWelcomeNotification"

/**
 * JWT `user_metadata` on the session cookie can lag behind Auth DB after
 * `admin.updateUserById` in `/auth/callback`. Always read from Admin for provisioning.
 */
async function readUserMetadataForProvisioning(
  userId: string,
  jwtMetadata: Record<string, unknown>
): Promise<{ meta: Record<string, unknown>; source: "admin" | "jwt" }> {
  try {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      console.warn(
        "[provision-service-business] admin.getUserById failed; using JWT user_metadata (may be stale after OAuth):",
        error?.message
      )
      return { meta: jwtMetadata, source: "jwt" }
    }
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
    return { meta, source: "admin" }
  } catch (e) {
    console.warn("[provision-service-business] admin client error; using JWT user_metadata:", e)
    return { meta: jwtMetadata, source: "jwt" }
  }
}

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

  const jwtMeta = (user.user_metadata ?? {}) as Record<string, unknown>
  const { meta: provisionMeta, source: metadataSource } = await readUserMetadataForProvisioning(user.id, jwtMeta)
  const sub = resolveServiceBusinessSubscriptionFromUserMetadata(provisionMeta)

  console.info(
    "[provision-service-business]",
    JSON.stringify({
      userId: user.id,
      metadataSource,
      trial_intent: provisionMeta.trial_intent === true,
      trial_workspace: typeof provisionMeta.trial_workspace === "string" ? provisionMeta.trial_workspace : null,
      trial_plan: typeof provisionMeta.trial_plan === "string" ? provisionMeta.trial_plan : null,
      signup_service_plan:
        typeof provisionMeta.signup_service_plan === "string" ? provisionMeta.signup_service_plan : null,
      signup_billing_cycle:
        typeof provisionMeta.signup_billing_cycle === "string" ? provisionMeta.signup_billing_cycle : null,
      resolvedStatus: sub.service_subscription_status,
      resolvedTier: sub.service_subscription_tier,
      trial_started_at_set: Boolean(sub.trial_started_at),
      trial_ends_at_set: Boolean(sub.trial_ends_at),
    })
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
