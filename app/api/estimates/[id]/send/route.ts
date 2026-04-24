import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { getBusinessWhatsAppTemplate } from "@/lib/communication/getBusinessWhatsAppTemplate"
import { renderWhatsAppTemplate } from "@/lib/communication/renderWhatsAppTemplate"
import { isValidEstimateTransition } from "@/lib/documentState"
import { inferFinzaWorkspaceFromIndustry } from "@/lib/email/buildFinzaResendTags"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { sendServiceWorkspaceDocumentEmail } from "@/lib/email/sendServiceWorkspaceDocumentEmail"
import { buildEstimateEmailHtml } from "@/lib/email/templates/estimate"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const estimateId = resolvedParams.id

    if (!estimateId) {
      return NextResponse.json(
        { error: "Estimate ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body", message: "Invalid JSON body" },
        { status: 400 }
      )
    }
    const bodyBusinessId =
      typeof body.business_id === "string" ? body.business_id : undefined
    const sendWhatsApp = body.sendWhatsApp === true
    const sendEmail = body.sendEmail === true
    const copyLink = body.copyLink === true

    const scope = await requireBusinessScopeForUser(supabase, user.id, bodyBusinessId)
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error, message: scope.error },
        { status: scope.status }
      )
    }
    const scopedBusinessId = scope.businessId

    const { data: estimateRow, error: estimateError } = await supabase
      .from("estimates")
      .select(`
        *,
        businesses (
          id,
          legal_name,
          trading_name,
          phone,
          whatsapp_phone,
          email,
          industry
        ),
        estimate_items (
          id,
          description,
          quantity,
          price,
          total
        )
      `)
      .eq("id", estimateId)
      .eq("business_id", scopedBusinessId)
      .single()

    if (estimateError || !estimateRow) {
      return NextResponse.json(
        {
          success: false,
          error: "We couldn't find this estimate. It may have been deleted or the link is incorrect.",
          message: "Estimate not found"
        },
        { status: 404 }
      )
    }

    const customerId = estimateRow.customer_id
    let customers: { id: string; name: string; email: string | null; phone: string | null; whatsapp_phone: string | null } | null = null
    if (customerId) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id, name, email, phone, whatsapp_phone")
        .eq("id", customerId)
        .single()
      customers = cust ?? null
    }
    const estimate = { ...estimateRow, customers }
    const currentStatus = estimate.status as any

    // Enforce state transitions: Send only allowed on draft, Resend only on sent
    const isResend = currentStatus === "sent"
    const isSend = currentStatus === "draft"

    if (!isSend && !isResend) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot send estimate with status "${currentStatus}". Only draft estimates can be sent, and only sent estimates can be resent.`,
          message: "Invalid state for send/resend action"
        },
        { status: 400 }
      )
    }

    // Generate public estimate URL (if public_token exists)
    let publicEstimateUrl = ""
    if (estimate.public_token) {
      publicEstimateUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/quote-public/${estimate.public_token}`
    }

    // Handle different send actions
    if (sendWhatsApp) {
      const customer = estimate.customers
      const phone = customer?.whatsapp_phone || customer?.phone

      if (!phone) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer phone number is not available. Please add a phone number to the customer profile.",
            message: "Phone number required"
          },
          { status: 400 }
        )
      }

      const businessName = estimate.businesses?.trading_name || estimate.businesses?.legal_name || "Our Business"
      const estimateNumber = estimate.estimate_number
        ? `#${estimate.estimate_number}`
        : estimate.id.substring(0, 8)

      const template = await getBusinessWhatsAppTemplate(supabase, estimate.business_id, "estimate")
      const message = renderWhatsAppTemplate(template, {
        customer_name: customer?.name || "Valued Customer",
        estimate_number: estimateNumber,
        total: "",
        currency: "",
        valid_until: estimate.expiry_date
          ? new Date(estimate.expiry_date).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : "",
        public_url: publicEstimateUrl || "",
        business_name: businessName,
      })

      const linkResult = buildWhatsAppLink(phone, message)
      if (!linkResult.ok) {
        return NextResponse.json(
          { success: false, error: linkResult.error, message: linkResult.error },
          { status: 400 }
        )
      }
      const whatsappUrl = linkResult.whatsappUrl

      // Update status only if sending (draft → sent), not if resending
      if (isSend) {
        if (!isValidEstimateTransition("draft", "sent")) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid state transition",
              message: "Cannot transition from draft to sent"
            },
            { status: 400 }
          )
        }
        await supabase
          .from("estimates")
          .update({ status: "sent" })
          .eq("id", estimateId)
          .eq("business_id", scopedBusinessId)
      }
      // If resending (status is already "sent"), don't change status

      // Log audit event
      await createAuditLog({
        businessId: estimate.business_id,
        actionType: isResend ? "estimate.resent_whatsapp" : "estimate.sent_whatsapp",
        entityType: "estimates",
        entityId: estimateId,
        newValues: isSend ? { status: "sent", sent_via: "whatsapp" } : { sent_via: "whatsapp" },
        description: `${isResend ? "Resent" : "Sent"} estimate ${estimateNumber} via WhatsApp to ${customer?.name}`,
        request,
      })

      return NextResponse.json({
        success: true,
        whatsappUrl,
        message: "WhatsApp link generated successfully",
      })
    }

    if (sendEmail) {
      const customer = estimate.customers
      const email = customer?.email

      if (!email) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer email address is not available. Please add an email to the customer profile.",
            message: "Email required"
          },
          { status: 400 }
        )
      }

      let tokenForEmail = (estimate.public_token as string | null) || null
      if (!tokenForEmail) {
        const generated = `est_${estimateId}_${Date.now()}`
        const { error: tokUpdErr } = await supabase
          .from("estimates")
          .update({ public_token: generated })
          .eq("id", estimateId)
          .eq("business_id", scopedBusinessId)
        if (tokUpdErr) {
          return NextResponse.json(
            {
              success: false,
              error: "Could not create a public link for this quote. Try again or use Copy link first.",
              message: tokUpdErr.message,
            },
            { status: 500 }
          )
        }
        tokenForEmail = generated
      }
      let emailQuotePublicBase = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      try {
        if (request.url) {
          const origin = new URL(request.url).origin
          if (origin) emailQuotePublicBase = origin
        }
      } catch {
        /* keep */
      }
      const publicEstimateUrlForEmail = `${emailQuotePublicBase}/quote-public/${tokenForEmail}`

      const businessName = estimate.businesses?.trading_name || estimate.businesses?.legal_name || "Our Business"
      const estimateNumber = estimate.estimate_number || estimate.id.substring(0, 8)
      const businessEmail = estimate.businesses?.email ?? undefined
      const businessIndustry = (estimate.businesses as { industry?: string | null } | null)?.industry ?? null
      const isServiceWorkspace = businessIndustry === "service"

      const result = isServiceWorkspace
        ? await sendServiceWorkspaceDocumentEmail({
            to: email,
            replyTo: businessEmail ?? "",
            subject: `Quote ${estimate.estimate_number ? `#${estimate.estimate_number}` : estimateNumber} from ${businessName}`,
            kind: "quote",
            businessName,
            customerName: customers?.name ?? null,
            documentTitleLine: estimate.estimate_number ? `Quote #${estimate.estimate_number}` : `Quote ${estimateNumber}`,
            contextLine: estimate.expiry_date
              ? `Valid until: ${new Date(estimate.expiry_date).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}`
              : null,
            publicUrl: publicEstimateUrlForEmail,
            meta: { documentType: "quote", documentId: estimateId, businessId: estimate.business_id },
          })
        : await sendTransactionalEmail({
            to: email,
            subject: `Estimate ${estimateNumber} from ${businessName}`,
            html: buildEstimateEmailHtml(estimate, businessName, {
              customerName: customers?.name ?? undefined,
              publicViewUrl: publicEstimateUrlForEmail,
            }),
            fromName: businessName,
            replyTo: businessEmail,
            finza: {
              businessId: estimate.business_id,
              documentId: estimateId,
              documentType: "quote",
              workspace: inferFinzaWorkspaceFromIndustry(businessIndustry),
            },
          })

      if (!result.success) {
        const noKey = result.reason === "no_api_key"
        const userMessage = noKey
          ? "Email is not configured. Add RESEND_API_KEY to your environment (e.g. Vercel → Environment Variables) and redeploy."
          : String(result.reason || "Email delivery failed")
        return NextResponse.json(
          { success: false, error: userMessage, message: userMessage },
          { status: 502 }
        )
      }

      // Email succeeded first — then mark sent (draft) so failed delivery never leaves a false "sent" state
      if (isSend) {
        if (!isValidEstimateTransition("draft", "sent")) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid state transition",
              message: "Cannot transition from draft to sent",
            },
            { status: 400 }
          )
        }
        await supabase
          .from("estimates")
          .update({ status: "sent" })
          .eq("id", estimateId)
          .eq("business_id", scopedBusinessId)
      }

      await createAuditLog({
        businessId: estimate.business_id,
        actionType: isResend ? "estimate.resent_email" : "estimate.sent_email",
        entityType: "estimates",
        entityId: estimateId,
        newValues: {
          ...(isSend ? { status: "sent", sent_via: "email" } : { sent_via: "email" }),
          resend_message_id: result.id,
          email_channel: isServiceWorkspace ? "service_documents" : "legacy",
        },
        description: `${isResend ? "Resent" : "Sent"} estimate ${estimate.estimate_number} via email to ${customer?.name}`,
        request,
      })

      return NextResponse.json({
        success: true,
        message: "Estimate email sent successfully",
      })
    }

    if (copyLink) {
      if (!publicEstimateUrl) {
        // Generate public token if it doesn't exist
        const publicToken = `est_${estimateId}_${Date.now()}`
        await supabase
          .from("estimates")
          .update({ public_token: publicToken })
          .eq("id", estimateId)
          .eq("business_id", scopedBusinessId)

        publicEstimateUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/quote-public/${publicToken}`
      }

      // Update status only if sending (draft → sent), not if resending
      if (isSend) {
        if (!isValidEstimateTransition("draft", "sent")) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid state transition",
              message: "Cannot transition from draft to sent"
            },
            { status: 400 }
          )
        }
        await supabase
          .from("estimates")
          .update({ status: "sent" })
          .eq("id", estimateId)
          .eq("business_id", scopedBusinessId)
      }
      // If resending (status is already "sent"), don't change status

      const estimateNumberLabel = estimate.estimate_number
        ? `#${estimate.estimate_number}`
        : estimate.id.substring(0, 8)
      await createAuditLog({
        businessId: estimate.business_id,
        actionType: isResend ? "estimate.resent_public_link" : "estimate.sent_public_link",
        entityType: "estimates",
        entityId: estimateId,
        newValues: isSend ? { status: "sent", sent_via: "public_link" } : { sent_via: "public_link" },
        description: `${isResend ? "Re-copied" : "Copied"} public link for estimate ${estimateNumberLabel}`,
        request,
      })

      return NextResponse.json({
        success: true,
        publicUrl: publicEstimateUrl,
        message: "Public link copied to clipboard",
      })
    }

    return NextResponse.json(
      { error: "No action specified" },
      { status: 400 }
    )
  } catch (error: any) {
    console.error("Error sending estimate:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error",
        message: "Failed to send estimate"
      },
      { status: 500 }
    )
  }
}

