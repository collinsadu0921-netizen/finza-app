import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

// This endpoint receives callbacks from MTN MoMo API
// In production, this should be secured with webhook verification

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // MTN MoMo callback structure (example)
    // {
    //   "financialTransactionId": "string",
    //   "externalId": "string",
    //   "amount": "string",
    //   "currency": "string",
    //   "payer": {
    //     "partyIdType": "MSISDN",
    //     "partyId": "233XXXXXXXXX"
    //   },
    //   "payerMessage": "string",
    //   "payeeNote": "string",
    //   "status": "SUCCESSFUL" | "FAILED" | "PENDING"
    // }

    const {
      financialTransactionId,
      externalId, // This should be our payment reference
      amount,
      currency,
      payer,
      status,
    } = body

    if (!externalId || !status) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()

    // Find payment by reference
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, invoice_id, amount, business_id")
      .eq("reference", externalId)
      .is("deleted_at", null)
      .single()

    if (paymentError || !payment) {
      console.error("Payment not found for reference:", externalId)
      return NextResponse.json(
        { success: false, error: "Payment not found" },
        { status: 404 }
      )
    }

    if (status === "SUCCESSFUL" || status === "successful") {
      // Update payment record
      const { error: updateError } = await supabase
        .from("payments")
        .update({
          reference: `${externalId}-${financialTransactionId || Date.now()}`,
          notes: `Mobile Money payment completed. Transaction ID: ${financialTransactionId || "N/A"}`,
        })
        .eq("id", payment.id)

      if (updateError) {
        console.error("Error updating payment:", updateError)
      }

      // Calculate invoice balance
      const { data: allPayments } = await supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", payment.invoice_id)
        .is("deleted_at", null)

      const totalPaid = allPayments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0

      // Get invoice total
      const { data: invoice } = await supabase
        .from("invoices")
        .select("total")
        .eq("id", payment.invoice_id)
        .single()

      const invoiceTotal = Number(invoice?.total || 0)
      const remainingBalance = invoiceTotal - totalPaid

      // Update invoice status
      let newStatus = "sent"
      if (remainingBalance <= 0) {
        newStatus = "paid"
      } else if (totalPaid > 0) {
        newStatus = "partially_paid"
      }

      const { error: invoiceUpdateError } = await supabase
        .from("invoices")
        .update({
          status: newStatus,
          paid_at: newStatus === "paid" ? new Date().toISOString() : null,
        })
        .eq("id", payment.invoice_id)

      if (invoiceUpdateError) {
        console.error("Error updating invoice status:", invoiceUpdateError)
      }

      // Send confirmation (you can add email/WhatsApp notification here)
      console.log(`Payment successful for invoice ${payment.invoice_id}. New status: ${newStatus}, Remaining balance: ${remainingBalance}`)
      
      // TODO: Send WhatsApp/Email confirmation to customer when payment is successful

      return NextResponse.json({
        success: true,
        message: "Payment processed successfully",
        payment_id: payment.id,
        invoice_status: newStatus
      })
    } else if (status === "FAILED" || status === "failed") {
      // Mark payment as failed (you might want to delete it or mark it differently)
      await supabase
        .from("payments")
        .update({
          notes: `Mobile Money payment failed. Status: ${status}`,
        })
        .eq("id", payment.id)

      return NextResponse.json({
        success: true,
        message: "Payment failed - payment record updated",
      })
    } else {
      // PENDING status - no action needed
      return NextResponse.json({
        success: true,
        message: "Payment still pending",
      })
    }
  } catch (error: any) {
    console.error("Error processing MoMo callback:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
