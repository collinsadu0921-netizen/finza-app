import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import { isInternalAnnouncementAdminEmail } from "@/lib/internalAnnouncementsAdmin"
import { collectAnnouncementRecipientEmails } from "@/lib/platform/collectAnnouncementRecipientEmails"
import { sendPlatformAnnouncementToRecipients } from "@/lib/email/platformAnnouncementBroadcast"
import type { PlatformAnnouncementAudienceScope, PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"
import { isAnnouncementActiveForDisplay } from "@/lib/platform/announcementsServer"

/**
 * POST /api/internal/announcements/[id]/send-email
 * Body: { skip?: number } — skip first N unique recipients (alphabetical) for batched sends.
 * Sends at most INTERNAL_ANNOUNCEMENT_EMAIL_BATCH_MAX (default 75) per request.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email || !isInternalAnnouncementAdminEmail(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = getSupabaseServiceRoleClient()
    if (!admin) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const skip = Math.max(0, parseInt(String((body as { skip?: unknown }).skip ?? "0"), 10) || 0)

    const batchMax = Math.max(
      1,
      Math.min(parseInt(process.env.INTERNAL_ANNOUNCEMENT_EMAIL_BATCH_MAX ?? "75", 10) || 75, 500)
    )
    const maxBusinessesScan = Math.max(
      200,
      Math.min(parseInt(process.env.INTERNAL_ANNOUNCEMENT_EMAIL_MAX_BUSINESSES_SCAN ?? "4000", 10) || 4000, 50_000)
    )

    const { data: row, error: fetchError } = await admin
      .from("platform_announcements")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (fetchError) {
      console.error("[send-email] fetch", fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const ann = row as PlatformAnnouncementRow
    if (!isAnnouncementActiveForDisplay(ann)) {
      return NextResponse.json(
        { error: "Announcement must be active and within its start/end window to email tenants." },
        { status: 400 }
      )
    }

    const { emails, businessesScanned, truncated } = await collectAnnouncementRecipientEmails(
      admin,
      ann.audience_scope as PlatformAnnouncementAudienceScope,
      { maxBusinessesScan }
    )

    const window = emails.slice(skip, skip + batchMax)
    const subject = `[Finza] ${ann.title}`
    const sendResult = await sendPlatformAnnouncementToRecipients({
      subject,
      title: ann.title,
      body: ann.body,
      recipients: window,
    })

    const nextSkip = skip + window.length
    const moreRecipients = nextSkip < emails.length
    const moreFromScan = truncated

    return NextResponse.json({
      sentOk: sendResult.ok,
      sentFailed: sendResult.failed,
      errors: sendResult.errors,
      batchSize: window.length,
      skip,
      nextSkip,
      moreRecipients,
      totalDistinctEmails: emails.length,
      businessesScanned,
      scanTruncated: moreFromScan,
      resendFailures: sendResult.errors,
    })
  } catch (e: unknown) {
    console.error("[send-email]", e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
