import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { getBusinessWhatsAppTemplate } from "@/lib/communication/getBusinessWhatsAppTemplate"
import { renderWhatsAppTemplate } from "@/lib/communication/renderWhatsAppTemplate"
import { isValidEstimateTransition } from "@/lib/documentState"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
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
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { sendEmail, sendWhatsApp, copyLink } = body

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
          email
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
      .eq("business_id", business.id)
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
      }
      // If resending (status is already "sent"), don't change status

      await createAuditLog({
        businessId: estimate.business_id,
        actionType: isResend ? "estimate.resent_email" : "estimate.sent_email",
        entityType: "estimates",
        entityId: estimateId,
        newValues: isSend ? { status: "sent", sent_via: "email" } : { sent_via: "email" },
        description: `${isResend ? "Resent" : "Sent"} estimate ${estimate.estimate_number} via email to ${customer?.name}`,
        request,
      })

      const businessName = estimate.businesses?.trading_name || estimate.businesses?.legal_name || "Our Business"
      const estimateNumber = estimate.estimate_number || estimate.id.substring(0, 8)
      const html = buildEstimateEmailHtml(estimate, businessName, {
        customerName: customers?.name ?? undefined,
        publicViewUrl: publicEstimateUrl || undefined,
      })
      const businessEmail = estimate.businesses?.email ?? undefined
      const result = await sendTransactionalEmail({
        to: email,
        subject: `Estimate ${estimateNumber} from ${businessName}`,
        html,
        fromName: businessName,
        replyTo: businessEmail,
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: "Email delivery failed", message: result.reason },
          { status: 502 }
        )
      }
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
      }
      // If resending (status is already "sent"), don't change status

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

