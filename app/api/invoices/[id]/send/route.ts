import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog, getIpAddress, getUserAgent } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import { getCurrencySymbol } from "@/lib/currency"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { getBusinessWhatsAppTemplate } from "@/lib/communication/getBusinessWhatsAppTemplate"
import { renderWhatsAppTemplate } from "@/lib/communication/renderWhatsAppTemplate"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { buildInvoiceEmailHtml } from "@/lib/email/templates/invoice"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import type { SupabaseClient } from "@supabase/supabase-js"

/** Performs the SEND transition: status → 'sent', assign invoice_number if missing, update DB. Triggers trigger_auto_post_invoice. */
async function performSendTransition(
  supabase: SupabaseClient,
  invoiceId: string,
  invoice: { business_id: string; invoice_number?: string | null; status?: string | null; sent_at?: string | null },
  sendMethod?: string
): Promise<{ data: any; error: { message: string } | null }> {
  // AR contract guard: draft invoices must not already have invoice_number.
  // Issued/sent invoices may legitimately already have one.
  if (invoice.status === "draft" && invoice.invoice_number) {
    return {
      data: null,
      error: { message: "Draft invoice has an unexpected invoice number. Cannot send until data is corrected." },
    }
  }

  const updateData: any = {
    status: "sent",
  }
  // Only set sent_at on first send. Once set (and especially after ledger posting), sent_at is immutable.
  if (!invoice.sent_at) {
    updateData.sent_at = new Date().toISOString()
  }
  if (!invoice.invoice_number) {
    const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
      business_uuid: invoice.business_id,
    })
    if (invoiceNumData) {
      updateData.invoice_number = invoiceNumData
    } else {
      return {
        data: null,
        error: { message: "Failed to generate invoice number. Cannot send invoice without invoice number." },
      }
    }
  }
  if (sendMethod != null) {
    updateData.sent_via_method = sendMethod
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(updateData)
    .eq("id", invoiceId)
    .select()
    .single()

  if (error && (error.message?.includes("sent_via_method") || error.message?.includes("column"))) {
    const retry: any = { status: "sent" }
    if (updateData.sent_at) retry.sent_at = updateData.sent_at
    if (updateData.invoice_number) retry.invoice_number = updateData.invoice_number
    const res = await supabase.from("invoices").update(retry).eq("id", invoiceId).select().single()
    return { data: res.data, error: res.error ? { message: res.error.message } : null }
  }
  return { data, error: error ? { message: error.message } : null }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be Promise)
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice ID is required" },
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
      return NextResponse.json({ error: "Business not found" }, { status: 403 })
    }

    const body = await request.json()
    const { email, sendEmail, sendWhatsApp, copyLink, sendMethod } = body

    // Verify invoice exists and belongs to session business only
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select(
        `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone
        ),
        businesses (
          id,
          legal_name,
          trading_name,
          phone,
          whatsapp_phone,
          email
        ),
        invoice_items (
          id,
          description,
          qty,
          unit_price,
          line_subtotal
        )
      `
      )
      .eq("id", invoiceId)
      .eq("business_id", business.id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        {
          success: false,
          error: "We couldn't find this invoice. It may have been deleted or you do not have access to it.",
          message: "Invoice not found"
        },
        { status: 403 }
      )
    }

    try {
      await assertBusinessNotArchived(supabase, invoice.business_id)
    } catch (e: any) {
      return NextResponse.json(
        { success: false, error: e?.message || "Business is archived" },
        { status: 403 }
      )
    }

    // Use request origin so email links match the host the user is on (avoids localhost in prod emails)
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    try {
      if (request.url) {
        const origin = new URL(request.url).origin
        if (origin) baseUrl = origin
      }
    } catch (_) {}

    // Ensure public_token when needed (avoid /invoice-public/undefined)
    let effectivePublicToken = invoice.public_token ?? null
    if ((sendWhatsApp || copyLink || sendEmail) && !effectivePublicToken) {
      // Prefer DB token generator, but fall back to local token to avoid blocking send/link.
      let tokenData: string | null = null
      try {
        const { data } = await supabase.rpc("generate_public_token")
        tokenData = data || null
      } catch (_err) {
        tokenData = null
      }

      const fallbackToken = Buffer.from(
        `${invoice.business_id}-${invoiceId}-${Date.now()}-${Math.random()}`
      ).toString("base64url")
      const tokenToPersist = tokenData || fallbackToken

      const { error: tokenUpdateError } = await supabase
        .from("invoices")
        .update({ public_token: tokenToPersist })
        .eq("id", invoiceId)
        .eq("business_id", invoice.business_id)

      if (!tokenUpdateError) {
        effectivePublicToken = tokenToPersist
        invoice.public_token = tokenToPersist
      } else {
        console.error("Failed to persist public_token before send:", tokenUpdateError)
      }
    }

    const publicInvoiceUrl = `${baseUrl}/invoice-public/${effectivePublicToken ?? ""}`

    // Handle different send actions
    if (sendWhatsApp) {
      const customer = invoice.customers
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

      if (!effectivePublicToken) {
        return NextResponse.json(
          {
            success: false,
            error: "Public invoice link could not be generated. Please try again.",
            message: "Public link unavailable"
          },
          { status: 500 }
        )
      }

      // Get currency symbol from currency code (no hardcoded fallback)
      const currencySymbol = invoice.currency_code
        ? getCurrencySymbol(invoice.currency_code)
        : null

      if (!currencySymbol) {
        return NextResponse.json(
          {
            success: false,
            error: "Currency symbol could not be determined. Please ensure invoice has a valid currency code.",
            message: "Currency symbol missing"
          },
          { status: 400 }
        )
      }

      const payUrl = `${baseUrl}/pay/${invoice.id}`
      const businessName =
        (invoice.businesses as { trading_name?: string; legal_name?: string } | null)?.trading_name ||
        (invoice.businesses as { legal_name?: string } | null)?.legal_name ||
        "Our Business"

      const template = await getBusinessWhatsAppTemplate(supabase, invoice.business_id, "invoice")
      const message = renderWhatsAppTemplate(template, {
        customer_name: customer?.name || "Valued Customer",
        invoice_number: invoice.invoice_number ? `#${invoice.invoice_number}` : "",
        total: Number(invoice.total).toFixed(2),
        currency: currencySymbol,
        due_date: invoice.payment_terms || "Due on receipt",
        public_url: publicInvoiceUrl,
        pay_url: payUrl,
        business_name: businessName,
      })

      const linkResult = buildWhatsAppLink(phone, message)
      if (!linkResult.ok) {
        return NextResponse.json(
          { success: false, error: linkResult.error, message: linkResult.error },
          { status: 400 }
        )
      }
      const { whatsappUrl, digits } = linkResult
      const e164Phone = `+${digits}`

      const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
      if (bootstrapErr) {
        return NextResponse.json(
          { success: false, error: bootstrapErr, message: bootstrapErr },
          { status: 500 }
        )
      }
      const { ready: accountingReady } = await checkAccountingReadiness(supabase, invoice.business_id)
      if (!accountingReady) {
        return NextResponse.json(
          {
            success: false,
            error: "Accounting is not set up for this business. Please complete accounting setup before sending invoices.",
            message: "Accounting not ready"
          },
          { status: 400 }
        )
      }
      const { data: updatedInvoice, error: transitionError } = await performSendTransition(
        supabase,
        invoiceId,
        invoice,
        sendMethod
      )
      if (transitionError || !updatedInvoice) {
        return NextResponse.json(
          {
            success: false,
            error: transitionError?.message ?? "We couldn't update the invoice status. Please try again.",
            message: transitionError?.message ?? "Update failed",
          },
          { status: 500 }
        )
      }

      try {
        await createAuditLog({
          businessId: invoice.business_id || "00000000-0000-0000-0000-000000000000",
          userId: user?.id || "00000000-0000-0000-0000-000000000000",
          actionType: "invoice.sent_whatsapp",
          entityType: "invoice",
          entityId: invoiceId,
          newValues: {
            invoice_number: updatedInvoice.invoice_number ?? invoice.invoice_number,
            recipient_phone: e164Phone,
          },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
          description: `Invoice sent via WhatsApp to ${e164Phone}`,
        })
      } catch (auditError) {
        console.error("Error logging audit:", auditError)
      }

      // Optional: server-side WhatsApp send via lib/communication/sendWhatsAppMessage (when provider configured)
      try {
        const { sendWhatsAppMessage } = await import("@/lib/communication/sendWhatsAppMessage")
        await sendWhatsAppMessage({
          to: e164Phone,
          body: message,
          reference: `inv-${invoiceId}-${updatedInvoice.invoice_number ?? ""}`,
          businessId: invoice.business_id,
          entityType: "invoice",
          entityId: invoiceId,
        })
      } catch (_) {
        // Non-blocking: client still has whatsappUrl for manual send
      }

      return NextResponse.json({
        success: true,
        whatsappUrl,
        invoice: updatedInvoice,
        message: "WhatsApp link generated",
      })
    }

    if (sendEmail && email) {
      const toEmail = String(email).trim().toLowerCase()
      if (!toEmail) {
        return NextResponse.json(
          { success: false, error: "Email address is required", message: "Email address is required" },
          { status: 400 }
        )
      }
      const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
      if (bootstrapErr) {
        return NextResponse.json(
          { success: false, error: bootstrapErr, message: bootstrapErr },
          { status: 500 }
        )
      }
      const { ready: accountingReady } = await checkAccountingReadiness(supabase, invoice.business_id)
      if (!accountingReady) {
        return NextResponse.json(
          {
            success: false,
            error: "Accounting is not set up for this business. Please complete accounting setup before sending invoices.",
            message: "Accounting not ready"
          },
          { status: 400 }
        )
      }

      // Send email first. Only mark as sent and post to ledger after email succeeds,
      // so a failed send leaves the invoice as draft.
      const businessName =
        (invoice.businesses as { trading_name?: string; legal_name?: string } | null)?.trading_name ||
        (invoice.businesses as { legal_name?: string } | null)?.legal_name ||
        "Our Business"
      const publicInvoiceUrlForEmail = `${baseUrl}/invoice-public/${effectivePublicToken ?? ""}`
      const payUrlForEmail = `${baseUrl}/pay/${invoiceId}`
      const invoiceForEmail = { ...invoice, invoice_items: invoice.invoice_items }
      const customerName = (invoice.customers as { name?: string } | null)?.name
      const html = buildInvoiceEmailHtml(invoiceForEmail, businessName, {
        publicViewUrl: effectivePublicToken ? publicInvoiceUrlForEmail : undefined,
        payUrl: payUrlForEmail,
        customerName: customerName ?? undefined,
      })
      const docLabel = invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice"
      const businessEmail = (invoice.businesses as { email?: string } | null)?.email ?? undefined
      const result = await sendTransactionalEmail({
        to: toEmail,
        subject: `${docLabel} from ${businessName}`,
        html,
        fromName: businessName,
        replyTo: businessEmail,
      })
      if (!result.success) {
        const noKey = result.reason === "no_api_key"
        const userMessage = noKey
          ? "Email is not configured. Add RESEND_API_KEY to your environment (e.g. Vercel → Environment Variables) and redeploy."
          : String(result.reason || "Email delivery failed")
        return NextResponse.json(
          {
            success: false,
            message: userMessage,
            error: result.reason,
          },
          { status: 502 }
        )
      }

      const { data: updatedInvoice, error: transitionError } = await performSendTransition(
        supabase,
        invoiceId,
        invoice,
        sendMethod
      )
      if (transitionError || !updatedInvoice) {
        return NextResponse.json(
          {
            success: false,
            error: transitionError?.message ?? "We couldn't update the invoice status. Please try again.",
            message: transitionError?.message ?? "Update failed",
          },
          { status: 500 }
        )
      }

      try {
        await createAuditLog({
          businessId: invoice.business_id || "00000000-0000-0000-0000-000000000000",
          userId: user?.id || "00000000-0000-0000-0000-000000000000",
          actionType: "invoice.sent_email",
          entityType: "invoice",
          entityId: invoiceId,
          newValues: {
            recipient_email: email,
            invoice_number: updatedInvoice.invoice_number ?? invoice.invoice_number,
          },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
          description: `Invoice sent via email to ${email}`,
        })
      } catch (auditError) {
        console.error("Error logging audit:", auditError)
      }

      return NextResponse.json({
        success: true,
        invoice: updatedInvoice,
        message: "Invoice sent via email",
      })
    }

    if (copyLink) {
      if (!effectivePublicToken) {
        return NextResponse.json(
          { success: false, error: "Public link could not be generated. Please try again.", message: "Public link unavailable" },
          { status: 500 }
        )
      }
      // Update sent_via_method but don't mark as sent (link copy is not a send)
      // Only update if column exists (graceful fallback)
      try {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({
            sent_via_method: sendMethod,
          })
          .eq("id", invoiceId)

        if (updateError && (updateError.message?.includes("sent_via_method") || updateError.message?.includes("column"))) {
          // Column doesn't exist, skip update
          console.log("sent_via_method column not found, skipping update")
        }
      } catch (e) {
        // Column might not exist, continue
      }

      return NextResponse.json({
        success: true,
        publicUrl: publicInvoiceUrl,
        message: "Link copied to clipboard",
      })
    }

    // Default: just mark as sent (same SEND transition as email/WhatsApp)
    const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
    if (bootstrapErr) {
      return NextResponse.json(
        { success: false, error: bootstrapErr, message: bootstrapErr },
        { status: 500 }
      )
    }
    const { ready: accountingReady } = await checkAccountingReadiness(supabase, invoice.business_id)
    if (!accountingReady) {
      return NextResponse.json(
        {
          success: false,
          error: "Accounting is not set up for this business. Please complete accounting setup before sending invoices.",
          message: "Accounting not ready"
        },
        { status: 400 }
      )
    }
    const { data: updatedInvoice, error: transitionError } = await performSendTransition(
      supabase,
      invoiceId,
      invoice,
      sendMethod
    )
    if (transitionError || !updatedInvoice) {
      return NextResponse.json(
        {
          success: false,
          error: transitionError?.message ?? "We couldn't update the invoice status. Please try again.",
          message: transitionError?.message ?? "Update failed",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
      message: "Invoice marked as sent",
    })
  } catch (error: any) {
    console.error("Error sending invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "We couldn't send the invoice. Please check your connection and try again.",
        message: error.message || "Internal server error"
      },
      { status: 500 }
    )
  }
}

