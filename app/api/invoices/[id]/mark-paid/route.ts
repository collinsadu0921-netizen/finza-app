import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { logReconciliationMismatch } from "@/lib/accounting/reconciliation/mismatch-logger"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"

/**
 * Mark Invoice as Paid
 * 
 * This endpoint creates a payment record for the full outstanding amount
 * instead of directly updating invoice status. This ensures:
 * - Payment record exists (audit trail)
 * - Payment allocation is created
 * - Ledger posting happens via trigger
 * - Invoice status is derived from payment state (via trigger)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    try {
      await assertBusinessNotArchived(supabase, business.id)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Business is archived" }, { status: 403 })
    }

    const body = await request.json()
    const { payment_reference, method = "cash", date, notes } = body

    // Verify invoice exists and belongs to business
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, total, status, business_id")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Calculate remaining balance
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", id)
      .is("deleted_at", null)

    const { data: creditNotes } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", id)
      .eq("status", "applied")
      .is("deleted_at", null)

    const totalPaid = existingPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const totalCredits = creditNotes?.reduce((sum, cn) => sum + Number(cn.total), 0) || 0
    const invoiceTotal = Number(invoice.total)
    const remainingBalance = invoiceTotal - totalPaid - totalCredits

    // If already fully paid, return success
    if (remainingBalance <= 0) {
      return NextResponse.json({
        invoice,
        message: "Invoice is already fully paid",
      })
    }

    // Validate payment method
    const validMethods = ["cash", "bank", "momo", "card", "cheque", "paystack", "other"]
    if (!validMethods.includes(method)) {
      return NextResponse.json(
        { error: "Invalid payment method" },
        { status: 400 }
      )
    }

    // Ledger reconciliation check (VALIDATE) — observe only, do not block
    try {
      const engine = createReconciliationEngine(supabase)
      const result = await engine.reconcileInvoice(
        { businessId: business.id, invoiceId: id },
        ReconciliationContext.VALIDATE
      )
      if (result.status !== ReconciliationStatus.OK) {
        logReconciliationMismatch(result)
      }
    } catch (_err) {
      // Do not block; log and continue
    }

    const bootstrap = await ensureAccountingInitialized(supabase, business.id)
    if (bootstrap.error) {
      const body = bootstrap.structuredError
        ? {
            error: bootstrap.error,
            error_code: bootstrap.structuredError.error_code,
            message: bootstrap.structuredError.message,
            step: bootstrap.structuredError.step,
            business_id: business.id,
            supabase_error: bootstrap.structuredError.supabase_error,
          }
        : { error: bootstrap.error }
      return NextResponse.json(body, { status: 500 })
    }

    // Generate public token for receipt
    const { data: tokenData } = await supabase.rpc("generate_public_token")
    const publicToken = tokenData || Buffer.from(`${business.id}-${id}-${Date.now()}`).toString("base64url")

    // Create payment for remaining balance
    const paymentDate = date || new Date().toISOString().split("T")[0]
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        business_id: business.id,
        invoice_id: id,
        amount: remainingBalance,
        date: paymentDate,
        method,
        reference: payment_reference || null,
        notes: notes || null,
        e_levy_amount: method === "momo" ? remainingBalance * 0.015 : 0,
        public_token: publicToken,
      })
      .select()
      .single()

    if (paymentError) {
      console.error("Error creating payment:", paymentError)
      return NextResponse.json(
        { error: paymentError.message || "Failed to create payment" },
        { status: 500 }
      )
    }

    // The database trigger will automatically:
    // 1. Update invoice status via recalculate_invoice_status()
    // 2. Post payment to ledger via post_invoice_payment_to_ledger()
    // 3. Create payment allocation

    // Reload invoice to get updated status
    const { data: updatedInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", id)
      .single()

    // Log audit entry
    await createAuditLog({
      businessId: business.id,
      userId: user.id,
      actionType: "payment.created",
      entityType: "payment",
      entityId: payment.id,
      oldValues: null,
      newValues: payment,
      request,
      description: `Payment of ${payment.amount} ${payment.method} created via mark-as-paid for invoice ${id}`,
    })

    return NextResponse.json({
      invoice: updatedInvoice,
      payment,
      message: "Invoice marked as paid via payment creation",
    })
  } catch (error: any) {
    console.error("Error marking invoice as paid:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

