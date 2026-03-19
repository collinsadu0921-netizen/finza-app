import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"
import { normalizeCountry, assertMethodAllowed } from "@/lib/payments/eligibility"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { logReconciliationMismatch } from "@/lib/accounting/reconciliation/mismatch-logger"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"

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
    const {
      invoice_id,
      amount,
      date,
      method,
      reference,
      notes,
      settlement_fx_rate, // Rate at time of payment for FX invoices (1 FX unit = X home currency)
    } = body

    // Validate method
    const validMethods = ["cash", "bank", "momo", "card", "cheque", "paystack", "other"]
    if (!validMethods.includes(method)) {
      return NextResponse.json(
        { 
          success: false,
          error: "Please select a valid payment method.",
          message: "Invalid payment method"
        },
        { status: 400 }
      )
    }

    // Validate required fields (business_id comes from session via invoice, never from body)
    if (!invoice_id || !amount || !date || !method) {
      return NextResponse.json(
        { 
          success: false,
          error: "Please fill in all required payment fields.",
          message: "Missing required fields"
        },
        { status: 400 }
      )
    }

    // Validate amount
    const amountNum = Number(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { 
          success: false,
          error: "Payment amount must be greater than 0.",
          message: "Invalid amount"
        },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 403 })
    }

    // Verify invoice exists and belongs to session business only (never trust body.business_id)
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, business_id, total, status, fx_rate, currency_code")
      .eq("id", invoice_id)
      .eq("business_id", business.id)
      .single()

    if (!invoice) {
      return NextResponse.json(
        { 
          success: false,
          error: "We couldn't find this invoice. It may have been deleted or you do not have access to it.",
          message: "Invoice not found"
        },
        { status: 403 }
      )
    }

    const business_id = invoice.business_id

    try {
      await assertBusinessNotArchived(supabase, business_id)
    } catch (e: any) {
      return NextResponse.json(
        { success: false, error: e?.message || "Business is archived" },
        { status: 403 }
      )
    }

    // Check payment method eligibility by country (use session business)
    const countryCode = normalizeCountry((business as { address_country?: string }).address_country)
    
    const methodMap: Record<string, "cash" | "card" | "mobile_money" | "bank_transfer"> = {
      "cash": "cash",
      "card": "card",
      "momo": "mobile_money",
      "bank": "bank_transfer",
    }
    
    const normalizedMethod = methodMap[method]
    
    if (normalizedMethod) {
      try {
        assertMethodAllowed(countryCode, normalizedMethod)
      } catch (error: any) {
        return NextResponse.json(
          { 
            success: false,
            error: error.message || "Payment method/provider not available for your country.",
            message: error.message || "Payment method/provider not available for your country."
          },
          { status: 403 }
        )
      }
    }

    // For FX invoices, settlement_fx_rate is required
    const isFxInvoice = !!(invoice as any).fx_rate
    const parsedSettlementFxRate = settlement_fx_rate ? Number(settlement_fx_rate) : null
    if (isFxInvoice && (!parsedSettlementFxRate || parsedSettlementFxRate <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: `Settlement rate is required for ${(invoice as any).currency_code} invoices. Please enter today's exchange rate.`,
          message: "Settlement rate required for FX invoice payment",
        },
        { status: 400 }
      )
    }

    if (invoice.status === "draft") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot record payment for a draft invoice. Issue the invoice first.",
          message: "Cannot record payment for a draft invoice. Issue the invoice first.",
        },
        { status: 400 }
      )
    }

    const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, business_id)
    if (bootstrapErr) {
      return NextResponse.json(
        { success: false, error: bootstrapErr, message: bootstrapErr },
        { status: 500 }
      )
    }

    // Calculate remaining balance for validation (payments + applied credit notes reduce balance)
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .is("deleted_at", null)

    const { data: appliedCredits } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoice_id)
      .eq("status", "applied")
      .is("deleted_at", null)

    const totalPaid = existingPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const totalCredits = appliedCredits?.reduce((sum, cn) => sum + Number(cn.total), 0) || 0
    const invoiceTotal = Number(invoice.total)
    const remainingBalance = invoiceTotal - totalPaid - totalCredits
    const remainingRounded = Math.round(remainingBalance * 100) / 100

    // SAFETY VALIDATION: Payment must not exceed remaining balance (currency precision)
    if (amountNum > remainingRounded) {
      return NextResponse.json(
        { 
          success: false,
          error: `Payment amount (${amountNum.toFixed(2)}) exceeds remaining balance (${remainingRounded.toFixed(2)}).`,
          message: "Payment amount exceeds invoice balance"
        },
        { status: 400 }
      )
    }

    // Ledger reconciliation check (VALIDATE, zero tolerance) — observe only, do not block
    try {
      const engine = createReconciliationEngine(supabase)
      const result = await engine.reconcileInvoice(
        { businessId: business_id, invoiceId: invoice_id },
        ReconciliationContext.VALIDATE
      )
      if (result.status !== ReconciliationStatus.OK) {
        logReconciliationMismatch(result)
      }
    } catch (reconcileErr) {
      // Do not block; log and continue
      console.warn("[payments/create] reconcileInvoice failed (non-blocking):", reconcileErr)
    }

    // Calculate E-Levy for mobile money (informational only)
    let eLevyAmount = 0
    if (method === "momo") {
      // E-Levy is 1.5% of the amount (informational only)
      eLevyAmount = Number(amount) * 0.015
    }

    // Generate public token for receipt
    const { data: tokenData } = await supabase.rpc("generate_public_token")
    const publicToken = tokenData || Buffer.from(`${business_id}-${invoice_id}-${Date.now()}`).toString("base64url")

    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        business_id,
        invoice_id,
        amount: Number(amount),
        date,
        method,
        reference: reference || null,
        notes: notes || null,
        e_levy_amount: eLevyAmount,
        public_token: publicToken,
        settlement_fx_rate: isFxInvoice ? parsedSettlementFxRate : null,
      })
      .select()
      .single()

    if (paymentError) {
      console.error("Error creating payment:", paymentError)
      return NextResponse.json(
        { 
          success: false,
          error: "Payment could not be saved. Please check all fields and try again.",
          message: paymentError.message
        },
        { status: 500 }
      )
    }

    // The database trigger (trigger_update_invoice_status) will automatically:
    // 1. Call recalculate_invoice_status() which considers payments + credit notes
    // 2. Update invoice status based on ledger reality
    // 3. Set paid_at timestamp when status becomes 'paid'
    // No manual status update needed - trigger is the source of truth

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "payment.created",
      entityType: "payment",
      entityId: payment.id,
      oldValues: null,
      newValues: payment,
      request,
      description: `Payment of ${payment.amount} ${payment.method} added to invoice ${invoice_id}`,
    })

    return NextResponse.json({ 
      success: true,
      payment,
      message: "Payment added successfully"
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating payment:", error)
    return NextResponse.json(
      { 
        success: false,
        error: "Payment could not be created. Please check all fields and try again.",
        message: error.message || "Internal server error"
      },
      { status: 500 }
    )
  }
}

