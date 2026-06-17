import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveServiceBusinessSubscriptionFromUserMetadata } from "@/lib/auth/resolveServiceBusinessSubscription"
import { sendServiceWelcomeNotificationsAfterProvision } from "@/lib/auth/sendServiceWelcomeNotification"
import { parsePhoneOrWhatsApp } from "@/lib/growth/parsePhoneOrWhatsApp"
import { SIGNUP_GOALS } from "@/lib/growth/signupGoals"
import { signupAttributionFromUserMetadata } from "@/lib/growth/signupAttribution"
import { voidRecordBusinessActivationEvent } from "@/lib/growth/recordBusinessActivationEvent"

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
  address_city: z.string().trim().max(120).nullable().optional(),
  default_currency: z.string().trim().min(1).max(16),
  start_date: z.string().trim().max(32).nullable().optional(),
  phone_or_whatsapp: z.string().trim().min(8).max(40),
  signup_goal: z.enum(SIGNUP_GOALS),
  signup_source: z.string().trim().max(200).nullable().optional(),
  signup_utm_source: z.string().trim().max(200).nullable().optional(),
  signup_utm_medium: z.string().trim().max(200).nullable().optional(),
  signup_utm_campaign: z.string().trim().max(200).nullable().optional(),
  trial_contact_consent: z.literal(true),
})

function coalesceAttribution(
  body: z.infer<typeof BodySchema>,
  meta: Record<string, unknown>
) {
  const fromMeta = signupAttributionFromUserMetadata(meta)
  return {
    signup_source: body.signup_source ?? fromMeta.signup_source,
    signup_utm_source: body.signup_utm_source ?? fromMeta.signup_utm_source,
    signup_utm_medium: body.signup_utm_medium ?? fromMeta.signup_utm_medium,
    signup_utm_campaign: body.signup_utm_campaign ?? fromMeta.signup_utm_campaign,
  }
}

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

  const body = parsed.data
  const phones = parsePhoneOrWhatsApp(body.phone_or_whatsapp)
  if (!phones) {
    return NextResponse.json(
      { error: "Please enter a valid phone or WhatsApp number (at least 8 digits)." },
      { status: 400 }
    )
  }

  const attribution = coalesceAttribution(body, provisionMeta)
  const consentAt = new Date().toISOString()

  console.info(
    "[provision-service-business]",
    JSON.stringify({
      userId: user.id,
      metadataSource,
      signup_goal: body.signup_goal,
      trial_contact_consent: true,
      signup_source: attribution.signup_source,
      resolvedStatus: sub.service_subscription_status,
      resolvedTier: sub.service_subscription_tier,
    })
  )

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({
      owner_id: user.id,
      name: body.name,
      industry: "service",
      address_country: body.address_country ?? null,
      address_city: body.address_city ?? null,
      default_currency: body.default_currency,
      start_date: body.start_date || null,
      phone: phones.phone,
      whatsapp_phone: phones.whatsapp_phone,
      signup_goal: body.signup_goal,
      signup_source: attribution.signup_source,
      signup_utm_source: attribution.signup_utm_source,
      signup_utm_medium: attribution.signup_utm_medium,
      signup_utm_campaign: attribution.signup_utm_campaign,
      trial_contact_consent: true,
      trial_contact_consent_at: consentAt,
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

  voidRecordBusinessActivationEvent(supabase, {
    businessId: business.id as string,
    eventName: "business_created",
    metadata: {
      signup_goal: body.signup_goal,
      signup_source: attribution.signup_source,
      service_subscription_status: sub.service_subscription_status,
    },
  })

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
