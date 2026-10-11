import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyTenantMtnInvoiceByReference } from "@/lib/tenantPayments/mtnInvoiceDirectService"
import { requireInvoiceIdForPublicTenantMtnStatus } from "@/lib/tenantPayments/mtnPublicMtnStatus"
import { assertInvoicePayCapability } from "@/lib/payments/invoicePayCapability"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

/**
 * **Compatibility / mixed public pay** — not the preferred entry for tenant MTN invoices.
 *
 * - `finza-mtn-*` → delegates to the **same** `verifyTenantMtnInvoiceByReference` as
 *   `GET /api/payments/momo/tenant/invoice/status`. **`invoice_id` required** (Phase 6/7).
 *   **Prefer** `/tenant/invoice/status` for new clients (clearer scope).
 * - Other references (e.g. Paystack `FNZ-…`) → **legacy inference** from `payments` + invoice (unchanged).
 *
 * **Authoritative MTN settlement** is always server-side MTN Collection status verify, never this route’s shape alone.
 */
export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get("reference")
    if (!reference) {
      return NextResponse.json({ success: false, error: "Reference is required" }, { status: 400 })
    }

    const invoiceIdParam = request.nextUrl.searchParams.get("invoice_id")
    const publicToken =
      request.nextUrl.searchParams.get("token")?.trim() ||
      request.nextUrl.searchParams.get("public_token")?.trim() ||
      ""

    const supabase = serviceClient()

    if (!invoiceIdParam?.trim() || !publicToken) {
      return NextResponse.json(
        { success: false, error: "invoice_id and public_token are required", status: "BAD_REQUEST" },
        { status: 400 }
      )
    }

    const capability = await assertInvoicePayCapability(supabase, invoiceIdParam, publicToken)
    if (!capability.ok) {
      return NextResponse.json(
        { success: false, error: capability.error, status: "NOT_FOUND" },
        { status: capability.statusCode }
      )
    }

    if (reference.startsWith("finza-mtn-")) {
      const invoiceCheck = requireInvoiceIdForPublicTenantMtnStatus(capability.invoice.id)
      if (!invoiceCheck.ok) {
        return NextResponse.json(
          { success: false, error: invoiceCheck.error, status: "BAD_REQUEST" },
          { status: invoiceCheck.statusCode }
        )
      }
      const r = await verifyTenantMtnInvoiceByReference(supabase, reference, {
        invoiceId: capability.invoice.id,
      })
      if (!r.ok) {
        return NextResponse.json({ success: false, error: r.error, status: "NOT_FOUND" }, { status: r.statusCode })
      }
      const st = r.status === "success" ? "SUCCESS" : r.status === "failed" ? "FAILED" : "PENDING"
      return NextResponse.json({
        success: true,
        status: st,
        payment_id: undefined,
        message: r.message,
        applied: r.applied,
      })
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("id, invoice_id, business_id, amount, reference, notes")
      .eq("reference", reference)
      .eq("invoice_id", capability.invoice.id)
      .eq("business_id", capability.invoice.business_id)
      .is("deleted_at", null)
      .maybeSingle()

    if (paymentError || !payment) {
      return NextResponse.json({ success: false, error: "Payment not found", status: "NOT_FOUND" }, { status: 404 })
    }

    const { data: invoice } = await supabase
      .from("invoices")
      .select("status")
      .eq("id", capability.invoice.id)
      .eq("business_id", capability.invoice.business_id)
      .maybeSingle()

    if (invoice?.status === "paid") {
      return NextResponse.json({
        success: true,
        status: "SUCCESS",
        payment_id: payment.id,
        message: "Payment completed successfully",
      })
    }

    if (payment.notes?.toLowerCase().includes("failed")) {
      return NextResponse.json({
        success: true,
        status: "FAILED",
        payment_id: payment.id,
        message: "Payment failed",
      })
    }

    return NextResponse.json({
      success: true,
      status: "PENDING",
      payment_id: payment.id,
      message: "Payment is still pending approval",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("[momo/status]", error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
