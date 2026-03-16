import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { getCurrencySymbol } from "@/lib/currency"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { getBusinessWhatsAppTemplate } from "@/lib/communication/getBusinessWhatsAppTemplate"
import { renderWhatsAppTemplate } from "@/lib/communication/renderWhatsAppTemplate"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { buildOrderEmailHtml } from "@/lib/email/templates/order"

/**
 * Send Order Confirmation
 * 
 * Orders are non-financial confirmations. Sending an order:
 * - Does NOT create invoices
 * - Does NOT create payments
 * - Does NOT touch ledger
 * - Only sends confirmation document to customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const orderId = resolvedParams.id

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required" },
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
    const { sendEmail, sendWhatsApp, copyLink, sendMethod, email } = body

    const { data: order, error: orderError } = await supabase
      .from("orders")
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
        order_items (
          id,
          description,
          quantity,
          unit_price,
          line_total
        )
      `
      )
      .eq("id", orderId)
      .eq("business_id", business.id)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        {
          success: false,
          error: "We couldn't find this order. It may have been deleted or the link is incorrect.",
          message: "Order not found"
        },
        { status: 404 }
      )
    }

    // Only issued orders can be sent as confirmations
    if (order.status !== "issued") {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot send order confirmation. Only issued orders can be sent. Current status: "${order.status}"`,
          message: "Invalid order status"
        },
        { status: 400 }
      )
    }

    // Generate public order URL (if public_token exists)
    let publicOrderUrl = ""
    if (order.public_token) {
      publicOrderUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/order-public/${order.public_token}`
    }

    // Handle different send actions
    if (sendWhatsApp) {
      const customer = order.customers
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

      const businessName = order.businesses?.trading_name || order.businesses?.legal_name || "Our Business"
      const orderReference = `ORD-${order.id.substring(0, 8).toUpperCase()}`
      const orderCurrencyCode = (order as { currency_code?: string }).currency_code || "GHS"
      const currencySymbol = getCurrencySymbol(orderCurrencyCode) || "₵"
      const totalAmount = Number(order.total_amount || 0).toFixed(2)

      const template = await getBusinessWhatsAppTemplate(supabase, order.business_id, "order")
      const message = renderWhatsAppTemplate(template, {
        customer_name: customer?.name || "Valued Customer",
        order_number: orderReference,
        total: totalAmount,
        currency: currencySymbol,
        public_url: publicOrderUrl || "",
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

      // Update confirmation metadata (does NOT change order status)
      const updateData: any = {
        confirmation_sent_at: new Date().toISOString(),
        confirmation_sent_by: user?.id || null,
      }

      // Only add confirmation_sent_via if column exists (graceful fallback)
      try {
        updateData.confirmation_sent_via = sendMethod || "whatsapp"
      } catch (e) {
        // Column might not exist yet, continue without it
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", orderId)

      if (updateError) {
        // If confirmation_sent_via column doesn't exist, try without it
        if (updateError.message?.includes("confirmation_sent_via") || updateError.message?.includes("column")) {
          const { error: retryError } = await supabase
            .from("orders")
            .update({
              confirmation_sent_at: new Date().toISOString(),
              confirmation_sent_by: user?.id || null,
            })
            .eq("id", orderId)

          if (retryError) {
            console.error("Error updating order confirmation metadata:", retryError)
          }
        } else {
          console.error("Error updating order confirmation metadata:", updateError)
        }
      }

      // Log audit event
      await createAuditLog({
        businessId: order.business_id,
        userId: user?.id || null,
        actionType: "order.confirmation_sent_whatsapp",
        entityType: "order",
        entityId: orderId,
        newValues: { confirmation_sent_via: "whatsapp" },
        description: `Order confirmation sent via WhatsApp to ${customer?.name}`,
        request,
      })

      return NextResponse.json({
        success: true,
        whatsappUrl,
        message: "WhatsApp link generated successfully",
      })
    }

    if (sendEmail && email) {
      const customer = order.customers

      if (!email && !customer?.email) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer email address is not available. Please add an email to the customer profile or provide one.",
            message: "Email required"
          },
          { status: 400 }
        )
      }

      const recipientEmail = email || customer?.email

      // Update confirmation metadata (does NOT change order status)
      const updateData: any = {
        confirmation_sent_at: new Date().toISOString(),
        confirmation_sent_by: user?.id || null,
      }

      // Only add confirmation_sent_via if column exists (graceful fallback)
      try {
        updateData.confirmation_sent_via = sendMethod || "email"
      } catch (e) {
        // Column might not exist yet, continue without it
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", orderId)

      if (updateError) {
        // If confirmation_sent_via column doesn't exist, try without it
        if (updateError.message?.includes("confirmation_sent_via") || updateError.message?.includes("column")) {
          const { error: retryError } = await supabase
            .from("orders")
            .update({
              confirmation_sent_at: new Date().toISOString(),
              confirmation_sent_by: user?.id || null,
            })
            .eq("id", orderId)

          if (retryError) {
            console.error("Error updating order confirmation metadata:", retryError)
          }
        } else {
          console.error("Error updating order confirmation metadata:", updateError)
        }
      }

      // Log audit event
      await createAuditLog({
        businessId: order.business_id,
        userId: user?.id || null,
        actionType: "order.confirmation_sent_email",
        entityType: "order",
        entityId: orderId,
        newValues: { 
          confirmation_sent_via: "email",
          recipient_email: recipientEmail,
        },
        description: `Order confirmation sent via email to ${recipientEmail}`,
        request,
      })

      const businessName = order.businesses?.trading_name || order.businesses?.legal_name || "Our Business"
      const orderNumber = `ORD-${order.id.substring(0, 8).toUpperCase()}`
      const html = buildOrderEmailHtml(order, businessName)
      const result = await sendTransactionalEmail({
        to: recipientEmail,
        subject: `Order ${orderNumber} from ${businessName}`,
        html,
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: "Email delivery failed", message: result.reason },
          { status: 502 }
        )
      }
      return NextResponse.json({
        success: true,
        message: "Order confirmation email sent successfully",
      })
    }

    if (copyLink) {
      if (!publicOrderUrl) {
        // Generate public token if it doesn't exist
        const publicToken = `ord_${orderId}_${Date.now()}`
        await supabase
          .from("orders")
          .update({ public_token: publicToken })
          .eq("id", orderId)

        publicOrderUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/order-public/${publicToken}`
      }

      // Update confirmation metadata for link copy
      const updateData: any = {
        confirmation_sent_at: new Date().toISOString(),
        confirmation_sent_by: user?.id || null,
      }

      try {
        updateData.confirmation_sent_via = sendMethod || "link"
      } catch (e) {
        // Column might not exist yet, continue without it
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", orderId)

      if (updateError && !updateError.message?.includes("confirmation_sent_via")) {
        console.error("Error updating order confirmation metadata:", updateError)
      }

      return NextResponse.json({
        success: true,
        publicUrl: publicOrderUrl,
        message: "Public link copied to clipboard",
      })
    }

    return NextResponse.json(
      { error: "No action specified" },
      { status: 400 }
    )
  } catch (error: any) {
    console.error("Error sending order confirmation:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error",
        message: "Failed to send order confirmation"
      },
      { status: 500 }
    )
  }
}
