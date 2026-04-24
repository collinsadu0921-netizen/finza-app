import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { inferFinzaWorkspaceFromIndustry } from "@/lib/email/buildFinzaResendTags"
import { sendServiceWorkspaceDocumentEmail } from "@/lib/email/sendServiceWorkspaceDocumentEmail"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import {
  normalizeProposalStatus,
  proposalStaffOutboundChannelsAllowed,
  proposalStaffSendInitialAllowed,
  proposalStatusIsTerminal,
  type ProposalStatus,
} from "@/lib/proposals/proposalState"
import type { ProposalMessagingContext } from "@/lib/proposals/proposalSendMessaging"
import {
  buildProposalDocumentTitleLine,
  buildProposalEmailContextLine,
  buildProposalEmailSubject,
  buildProposalTransactionalEmailHtml,
  buildProposalWhatsAppMessage,
  buildProposalWhatsAppUrl,
} from "@/lib/proposals/proposalSendMessaging"

export const dynamic = "force-dynamic"

const sendChannelSchema = z.enum(["mark_sent", "email", "whatsapp"])

const bodySchema = z
  .object({
    business_id: z.string().uuid(),
    channel: sendChannelSchema.optional(),
  })
  .strict()

type SendChannel = z.infer<typeof sendChannelSchema>

function businessDisplayName(b: {
  trading_name?: string | null
  legal_name?: string | null
  name?: string | null
}): string {
  return (
    (b.trading_name && String(b.trading_name).trim()) ||
    (b.legal_name && String(b.legal_name).trim()) ||
    (b.name && String(b.name).trim()) ||
    "Our business"
  )
}

function terminalError(status: ProposalStatus) {
  return NextResponse.json(
    {
      success: false,
      error: `This proposal is ${status} and can no longer be sent or shared.`,
      channel: null,
    },
    { status: 403 }
  )
}

/**
 * POST /api/proposals/[id]/send
 * Channels: mark_sent (default), email, whatsapp.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: proposalId } = await Promise.resolve(params)
    if (!proposalId) {
      return NextResponse.json({ success: false, error: "Proposal id required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    const json = await request.json().catch(() => ({}))
    const body = bodySchema.safeParse(json)
    if (!body.success) {
      return NextResponse.json({ success: false, error: "Invalid body", details: body.error.flatten() }, { status: 400 })
    }

    const channel: SendChannel = body.data.channel ?? "mark_sent"

    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.data.business_id)
    if (!scope.ok) {
      return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const origin = new URL(request.url).origin

    const { data: row, error: loadErr } = await supabase
      .from("proposals")
      .select("id, business_id, customer_id, status, public_token, sent_at, title, proposal_number, expires_at")
      .eq("id", proposalId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadErr || !row) {
      return NextResponse.json({ success: false, error: "Proposal not found" }, { status: 404 })
    }

    const proposalRow = row
    const editorUserId = user.id

    const status = normalizeProposalStatus(proposalRow.status as string)
    const public_url = `${origin}/proposal-public/${encodeURIComponent(proposalRow.public_token as string)}`

    if (proposalStatusIsTerminal(status)) {
      return terminalError(status)
    }

    if (!proposalStaffOutboundChannelsAllowed(status)) {
      return NextResponse.json(
        { success: false, error: "This proposal cannot be sent in its current state.", channel },
        { status: 400 }
      )
    }

    const { data: businessRow } = await supabase
      .from("businesses")
      .select("id, name, legal_name, trading_name, email, industry")
      .eq("id", businessId)
      .maybeSingle()

    const bizName = businessRow ? businessDisplayName(businessRow) : "Our business"
    const businessEmail = (businessRow?.email && String(businessRow.email).trim()) || ""
    const isServiceWorkspace = (businessRow?.industry || "").trim().toLowerCase() === "service"

    let customer: {
      id: string
      name: string | null
      email: string | null
      phone: string | null
      whatsapp_phone: string | null
    } | null = null
    if (proposalRow.customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone")
        .eq("id", proposalRow.customer_id as string)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .maybeSingle()
      customer = cust ?? null
    }

    const messagingCtx: ProposalMessagingContext = {
      businessDisplayName: bizName,
      proposalTitle: (proposalRow.title as string) || "",
      proposalNumber: (proposalRow.proposal_number as string | null) ?? null,
      customerName: customer?.name ?? null,
      publicProposalUrl: public_url,
      expiresAtIso: (proposalRow.expires_at as string | null) ?? null,
    }

    const isFirstSendTransition = proposalStaffSendInitialAllowed(status)

    const transitionDraftToSentIfNeeded = async (): Promise<
      { ok: true; sent_at: string } | { ok: false; message: string }
    > => {
      if (!isFirstSendTransition) {
        return { ok: true, sent_at: (proposalRow.sent_at as string) || new Date().toISOString() }
      }
      const now = new Date().toISOString()
      const { data: updated, error: upErr } = await supabase
        .from("proposals")
        .update({
          status: "sent",
          sent_at: (proposalRow.sent_at as string) || now,
          updated_by_user_id: editorUserId,
        })
        .eq("id", proposalId)
        .eq("business_id", businessId)
        .eq("status", "draft")
        .select("id, status, public_token, sent_at, title")
        .maybeSingle()

      if (upErr || !updated) {
        const { data: again } = await supabase
          .from("proposals")
          .select("id, status, sent_at, public_token")
          .eq("id", proposalId)
          .eq("business_id", businessId)
          .maybeSingle()
        if (again && !proposalStaffSendInitialAllowed(normalizeProposalStatus(again.status as string))) {
          return { ok: true, sent_at: (again.sent_at as string) || now }
        }
        return { ok: false, message: "Could not update proposal status." }
      }
      return { ok: true, sent_at: updated.sent_at as string }
    }

    /** Reload proposal row for response (minimal fields). */
    const loadProposalSnapshot = async () => {
      const { data: snap } = await supabase
        .from("proposals")
        .select("id, status, public_token, sent_at, title")
        .eq("id", proposalId)
        .eq("business_id", businessId)
        .maybeSingle()
      return snap
    }

    // ─── mark_sent (default; backward compatible) ───────────────────────────
    if (channel === "mark_sent") {
      if (!proposalStaffSendInitialAllowed(status)) {
        const snap = await loadProposalSnapshot()
        return NextResponse.json({
          success: true,
          channel: "mark_sent",
          public_url,
          whatsapp_url: null,
          email_delivery_status: null,
          proposal: snap || proposalRow,
          already_marked_sent: true,
        })
      }

      const t = await transitionDraftToSentIfNeeded()
      if (!t.ok) {
        return NextResponse.json({ success: false, error: t.message, channel: "mark_sent" }, { status: 500 })
      }

      const snap = await loadProposalSnapshot()
      await createAuditLog({
        businessId,
        userId: editorUserId,
        actionType: "proposal.sent",
        entityType: "proposal",
        entityId: proposalId,
        newValues: { status: "sent", channel: "mark_sent", sent_at: t.sent_at },
        request,
      })

      return NextResponse.json({
        success: true,
        channel: "mark_sent",
        public_url,
        whatsapp_url: null,
        email_delivery_status: null,
        proposal: snap,
        already_marked_sent: false,
      })
    }

    // ─── email ───────────────────────────────────────────────────────────────
    if (channel === "email") {
      const toEmail = (customer?.email || "").trim().toLowerCase()
      if (!customer) {
        return NextResponse.json(
          {
            success: false,
            error: "Link this proposal to a customer before sending by email.",
            channel: "email",
            public_url,
          },
          { status: 400 }
        )
      }
      if (!toEmail) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer email address is not available. Add an email to the customer profile.",
            channel: "email",
            public_url,
          },
          { status: 400 }
        )
      }

      const subject = buildProposalEmailSubject(messagingCtx)
      const titleLine = buildProposalDocumentTitleLine(messagingCtx)
      const contextLine = buildProposalEmailContextLine(messagingCtx)

      const emailResult = isServiceWorkspace
        ? await sendServiceWorkspaceDocumentEmail({
            to: toEmail,
            replyTo: businessEmail,
            subject,
            kind: "proposal",
            businessName: bizName,
            customerName: customer.name,
            documentTitleLine: titleLine,
            contextLine,
            publicUrl: public_url,
            meta: { documentType: "proposal", documentId: proposalId, businessId },
          })
        : await sendTransactionalEmail({
            to: toEmail,
            subject,
            ...buildProposalTransactionalEmailHtml(messagingCtx),
            fromName: bizName,
            replyTo: businessEmail || undefined,
            finza: {
              businessId,
              documentId: proposalId,
              documentType: "proposal",
              workspace: inferFinzaWorkspaceFromIndustry(businessRow?.industry),
            },
          })

      if (!emailResult.success) {
        const noKey = emailResult.reason === "no_api_key"
        const userMessage = noKey
          ? "Email is not configured. Add RESEND_API_KEY to your environment (e.g. Vercel → Environment Variables) and redeploy."
          : String(emailResult.reason || "Email delivery failed")
        return NextResponse.json(
          {
            success: false,
            error: userMessage,
            channel: "email",
            public_url,
            email_delivery_status: "failed",
          },
          { status: 502 }
        )
      }

      if (isFirstSendTransition) {
        const t = await transitionDraftToSentIfNeeded()
        if (!t.ok) {
          return NextResponse.json(
            {
              success: false,
              error: "Email was sent but updating the proposal to “sent” failed. Refresh the page and verify status.",
              channel: "email",
              public_url,
              email_delivery_status: "sent_status_uncertain",
            },
            { status: 500 }
          )
        }
      }

      const snap = await loadProposalSnapshot()
      await createAuditLog({
        businessId,
        userId: editorUserId,
        actionType: isFirstSendTransition ? "proposal.email_sent" : "proposal.email_resent",
        entityType: "proposal",
        entityId: proposalId,
        newValues: {
          channel: "email",
          to: toEmail,
          resend_message_id: "id" in emailResult ? emailResult.id : undefined,
          first_send: isFirstSendTransition,
        },
        description: `${isFirstSendTransition ? "Sent" : "Resent"} proposal email to ${toEmail}`,
        request,
      })

      return NextResponse.json({
        success: true,
        channel: "email",
        public_url,
        whatsapp_url: null,
        /** Resend accepted the message; not the same as mailbox delivery (no webhooks yet). */
        email_delivery_status: "accepted",
        resend_message_id: "id" in emailResult ? emailResult.id : undefined,
        proposal: snap,
        already_marked_sent: !isFirstSendTransition,
        subject,
      })
    }

    // ─── whatsapp ────────────────────────────────────────────────────────────
    if (channel === "whatsapp") {
      const message = buildProposalWhatsAppMessage(messagingCtx)
      const phone = (customer?.whatsapp_phone || customer?.phone || "").trim() || null
      const whatsapp_url = buildProposalWhatsAppUrl(message, phone)

      if (isFirstSendTransition) {
        const t = await transitionDraftToSentIfNeeded()
        if (!t.ok) {
          return NextResponse.json(
            {
              success: false,
              error: "Could not mark the proposal as sent after preparing WhatsApp. Try again.",
              channel: "whatsapp",
              public_url,
              whatsapp_url,
            },
            { status: 500 }
          )
        }
      }

      const snap = await loadProposalSnapshot()
      await createAuditLog({
        businessId,
        userId: editorUserId,
        actionType: isFirstSendTransition ? "proposal.whatsapp_shared" : "proposal.whatsapp_reshared",
        entityType: "proposal",
        entityId: proposalId,
        newValues: {
          channel: "whatsapp",
          targeted_phone: !!phone,
          first_send: isFirstSendTransition,
        },
        description: `${isFirstSendTransition ? "Shared" : "Re-shared"} proposal via WhatsApp`,
        request,
      })

      return NextResponse.json({
        success: true,
        channel: "whatsapp",
        public_url,
        whatsapp_url,
        email_delivery_status: null,
        proposal: snap,
        already_marked_sent: !isFirstSendTransition,
      })
    }

    return NextResponse.json({ success: false, error: "Unsupported channel" }, { status: 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Send failed"
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
