import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const reference = searchParams.get("reference")

    if (!reference) {
      return NextResponse.json(
        { success: false, error: "Reference is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()

    // Find payment by reference
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, invoice_id, amount, reference, notes")
      .eq("reference", reference)
      .is("deleted_at", null)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json(
        { success: false, error: "Payment not found", status: "NOT_FOUND" },
        { status: 404 }
      )
    }

    // Check invoice status to determine payment status
    const { data: invoice } = await supabase
      .from("invoices")
      .select("status")
      .eq("id", payment.invoice_id)
      .single()

    // If invoice is paid, payment was successful
    if (invoice?.status === "paid") {
      return NextResponse.json({
        success: true,
        status: "SUCCESS",
        payment_id: payment.id,
        message: "Payment completed successfully"
      })
    }

    // Check if payment notes indicate failure
    if (payment.notes?.toLowerCase().includes("failed")) {
      return NextResponse.json({
        success: true,
        status: "FAILED",
        payment_id: payment.id,
        message: "Payment failed"
      })
    }

    // Otherwise, still pending
    return NextResponse.json({
      success: true,
      status: "PENDING",
      payment_id: payment.id,
      message: "Payment is still pending approval"
    })
  } catch (error: any) {
    console.error("Error checking payment status:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
