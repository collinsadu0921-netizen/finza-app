import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { generateEmailReceipt, generateSMSReceipt, type ReceiptData } from "@/lib/receipts/template"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { inferFinzaWorkspaceFromIndustry } from "@/lib/email/buildFinzaResendTags"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { sale_id, channel, destination } = body

    if (!sale_id || !channel || !destination) {
      return NextResponse.json(
        { error: "Missing required fields: sale_id, channel, destination" },
        { status: 400 }
      )
    }

    if (channel !== "email" && channel !== "sms") {
      return NextResponse.json(
        { error: "Channel must be 'email' or 'sms'" },
        { status: 400 }
      )
    }

    // Validate email format if channel is email
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    // Load sale first to get its business_id (fix: use sale's business, not getCurrentBusiness)
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email
        ),
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          default_currency,
          industry
        )
      `)
      .eq("id", sale_id)
      .single()

    if (saleError || !sale) {
      return NextResponse.json(
        { error: "Sale not found" },
        { status: 404 }
      )
    }

    // Verify user has access to the sale's business
    const saleBusinessId = sale.business_id
    if (!saleBusinessId) {
      return NextResponse.json(
        { error: "Sale has no business associated" },
        { status: 400 }
      )
    }

    // Check if user is owner of the sale's business
    const { data: saleBusiness } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", saleBusinessId)
      .single()

    const isOwner = saleBusiness?.owner_id === user.id

    // If not owner, check if user has role in business_users
    if (!isOwner) {
      const { data: businessUser } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", saleBusinessId)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!businessUser) {
        return NextResponse.json(
          { error: "Access denied: You do not have access to this sale's business" },
          { status: 403 }
        )
      }
    }

    // Load sale items
    const { data: saleItems, error: itemsError } = await supabase
      .from("sale_items")
      .select("*")
      .eq("sale_id", sale_id)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error loading sale items:", itemsError)
    }

    // Load business currency (use sale's business)
    const businessData = sale.businesses || (await supabase
      .from("businesses")
      .select("name, legal_name, trading_name, default_currency")
      .eq("id", saleBusinessId)
      .single()).data

    const businessName = businessData?.trading_name || businessData?.legal_name || businessData?.name || "Business"
    const currencyCode = businessData?.default_currency || null

    // Build receipt data from ledger-final values only
    const customer = sale.customers
    const formatDate = (dateString: string) => {
      const date = new Date(dateString)
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    }
    const formatTime = (dateString: string) => {
      const date = new Date(dateString)
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    }

    // Extract tax breakdown from tax_lines (canonical source)
    const { vat, nhil, getfund } = getGhanaLegacyView(sale.tax_lines)
    const totalTax = sale.total_tax ?? (sale.tax_lines ? sumTaxLines(sale.tax_lines) : 0)

    // Calculate subtotal from sale.amount - totalTax (ledger-final)
    const subtotal = (sale.amount || 0) - totalTax

    const receiptData: ReceiptData = {
      businessName,
      receiptNumber: sale.id.substring(0, 8).toUpperCase(),
      date: formatDate(sale.created_at),
      time: formatTime(sale.created_at),
      customerName: customer?.name || undefined,
      customerPhone: customer?.phone || undefined,
      customerEmail: customer?.email || undefined,
      items: (saleItems || []).map((item: any) => ({
        name: item.product_name || item.name || "Unknown Product",
        quantity: item.quantity || item.qty || 1,
        unitPrice: Number(item.unit_price || item.price || 0),
        total: (item.quantity || item.qty || 1) * Number(item.unit_price || item.price || 0),
      })),
      subtotal,
      taxBreakdown: {
        vat: vat > 0 ? vat : undefined,
        nhil: nhil > 0 ? nhil : undefined,
        getfund: getfund > 0 ? getfund : undefined,
        covid: 0, // RETAIL: COVID removed
      },
      totalTax,
      totalPaid: sale.amount || 0, // Ledger-final total
      paymentMethod: sale.payment_method || "cash",
      paymentStatus: sale.payment_status || "paid",
      isRefunded: sale.payment_status === "refunded",
      isVoided: sale.payment_status === "voided",
      currencyCode,
    }

    // Create receipt send log entry (pending status)
    const { data: receiptSend, error: logError } = await supabase
      .from("receipt_sends")
      .insert({
        sale_id: sale_id,
        channel,
        destination,
        status: "pending",
      })
      .select()
      .single()

    if (logError) {
      console.error("Error creating receipt send log:", logError)
      // Continue anyway - logging failure shouldn't block send
    }

    let sendResult: { success: boolean; error?: string; providerResponse?: any } = {
      success: false,
      error: "Send functionality not yet implemented",
    }

    // Send receipt based on channel
    if (channel === "email") {
      const emailContent = generateEmailReceipt(receiptData)
      const bizIndustry = (sale.businesses as { industry?: string | null } | null)?.industry ?? null
      const result = await sendTransactionalEmail({
        to: destination,
        subject: `Receipt from ${businessName} - ${receiptData.receiptNumber}`,
        html: emailContent,
        finza: {
          businessId: saleBusinessId,
          documentId: sale_id,
          documentType: "receipt",
          workspace: inferFinzaWorkspaceFromIndustry(bizIndustry),
        },
      })
      sendResult = result.success
        ? { success: true, providerResponse: { id: result.id } }
        : { success: false, error: result.reason }
    } else if (channel === "sms") {
      // TODO: Implement actual SMS sending
      // For now, log the SMS that would be sent
      const smsContent = generateSMSReceipt(receiptData)
      console.log("=".repeat(50))
      console.log("RECEIPT SMS (TO BE SENT):")
      console.log(`To: ${destination}`)
      console.log(`Message:\n${smsContent}`)
      console.log("=".repeat(50))

      // When SMS service is integrated, replace above with:
      // sendResult = await sendSMS({
      //   to: destination,
      //   message: smsContent,
      // })

      // For now, mark as sent for testing
      sendResult = {
        success: true,
        providerResponse: { logged: true },
      }
    }

    // Update receipt send log with result
    if (receiptSend) {
      await supabase
        .from("receipt_sends")
        .update({
          status: sendResult.success ? "sent" : "failed",
          provider_response: sendResult.providerResponse ? JSON.stringify(sendResult.providerResponse) : null,
          error_message: sendResult.error || null,
          sent_at: sendResult.success ? new Date().toISOString() : null,
        })
        .eq("id", receiptSend.id)
    }

    if (!sendResult.success) {
      return NextResponse.json(
        {
          error: sendResult.error || "Failed to send receipt",
          receipt_send_id: receiptSend?.id,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Receipt sent via ${channel} to ${destination}`,
      receipt_send_id: receiptSend?.id,
    })
  } catch (error: any) {
    console.error("Error in POST /api/receipts/send:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
