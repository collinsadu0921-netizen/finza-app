import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

/**
 * POST /api/supplier-payments
 * Create a supplier payment and post to ledger
 */
export async function POST(request: NextRequest) {
  try {
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
    const {
      supplier_id,
      supplier_invoice_id,
      purchase_order_id,
      amount,
      payment_method,
      payment_reference,
      payment_date,
    } = body

    // Validation
    if (!supplier_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: "Missing required fields: supplier_id, amount, payment_method" },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than 0" },
        { status: 400 }
      )
    }

    // Verify supplier belongs to business
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("id", supplier_id)
      .eq("business_id", business.id)
      .single()

    if (supplierError || !supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    // Validate invoice if provided
    if (supplier_invoice_id) {
      const { data: invoice, error: invoiceError } = await supabase
        .from("supplier_invoices")
        .select("id, total_amount, status")
        .eq("id", supplier_invoice_id)
        .eq("business_id", business.id)
        .eq("supplier_id", supplier_id)
        .single()

      if (invoiceError || !invoice) {
        return NextResponse.json(
          { error: "Supplier invoice not found or does not match supplier" },
          { status: 404 }
        )
      }

      if (invoice.status === "paid") {
        return NextResponse.json(
          { error: "Invoice is already paid" },
          { status: 400 }
        )
      }

      // Check if payment exceeds invoice total
      const { data: existingPayments } = await supabase
        .from("supplier_payments")
        .select("amount")
        .eq("supplier_invoice_id", supplier_invoice_id)

      const totalPaid = (existingPayments || []).reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
      )

      if (totalPaid + amount > invoice.total_amount) {
        return NextResponse.json(
          {
            error: `Payment amount (${amount}) would exceed invoice total (${invoice.total_amount}). Already paid: ${totalPaid}`,
          },
          { status: 400 }
        )
      }
    }

    // Create payment
    const { data: payment, error: paymentError } = await supabase
      .from("supplier_payments")
      .insert({
        business_id: business.id,
        supplier_id,
        supplier_invoice_id: supplier_invoice_id || null,
        purchase_order_id: purchase_order_id || null,
        amount: Number(amount),
        payment_method: payment_method,
        payment_reference: payment_reference || null,
        payment_date: payment_date || new Date().toISOString().split("T")[0],
        created_by: user.id,
      })
      .select()
      .single()

    if (paymentError || !payment) {
      console.error("Error creating payment:", paymentError)
      return NextResponse.json(
        { error: "Failed to create payment" },
        { status: 500 }
      )
    }

    // Post to ledger using RPC function
    const { data: journalId, error: ledgerError } = await supabase.rpc(
      "post_supplier_payment_to_ledger",
      { p_supplier_payment_id: payment.id }
    )

    if (ledgerError) {
      console.error("Error posting to ledger:", ledgerError)
      // Rollback: delete payment if ledger posting fails
      await supabase.from("supplier_payments").delete().eq("id", payment.id)
      return NextResponse.json(
        {
          error: `Failed to post payment to ledger: ${ledgerError.message}`,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      payment,
      journal_id: journalId,
    })
  } catch (error: any) {
    console.error("Error in POST /api/supplier-payments:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/supplier-payments
 * List supplier payments (optionally filtered)
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const supplierId = searchParams.get("supplier_id")
    const invoiceId = searchParams.get("supplier_invoice_id")

    let query = supabase
      .from("supplier_payments")
      .select(`
        *,
        supplier:suppliers(id, name),
        supplier_invoice:supplier_invoices(id, invoice_number, total_amount),
        purchase_order:purchase_orders(id, reference)
      `)
      .eq("business_id", business.id)
      .order("payment_date", { ascending: false })

    if (supplierId) {
      query = query.eq("supplier_id", supplierId)
    }

    if (invoiceId) {
      query = query.eq("supplier_invoice_id", invoiceId)
    }

    const { data: payments, error } = await query

    if (error) {
      console.error("Error loading payments:", error)
      return NextResponse.json(
        { error: "Failed to load payments" },
        { status: 500 }
      )
    }

    return NextResponse.json({ payments: payments || [] })
  } catch (error: any) {
    console.error("Error in GET /api/supplier-payments:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
