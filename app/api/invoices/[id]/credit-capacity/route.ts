import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { computeInvoiceCreditCapacity } from "@/lib/creditNotes/invoiceCreditCapacity"

/**
 * GET /api/invoices/[id]/credit-capacity
 * Returns remaining creditable amount for credit notes (applied credits only).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id

    if (!invoiceId) {
      return NextResponse.json({ error: "Invoice ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: invoiceCheck, error: checkError } = await supabase
      .from("invoices")
      .select("id, business_id, deleted_at")
      .eq("id", invoiceId)
      .maybeSingle()

    if (checkError) {
      console.error("credit-capacity invoice check:", checkError)
      return NextResponse.json({ error: "Error checking invoice" }, { status: 500 })
    }

    if (!invoiceCheck || invoiceCheck.deleted_at) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const role = await getUserRole(supabase, user.id, invoiceCheck.business_id)
    if (!role) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, total, subtotal, total_tax")
      .eq("id", invoiceId)
      .eq("business_id", invoiceCheck.business_id)
      .is("deleted_at", null)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const { data: appliedCredits, error: creditsError } = await supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoiceId)
      .eq("business_id", invoiceCheck.business_id)
      .eq("status", "applied")
      .is("deleted_at", null)

    if (creditsError) {
      console.error("credit-capacity credits fetch:", creditsError)
      return NextResponse.json({ error: "Failed to load credit notes" }, { status: 500 })
    }

    const capacity = computeInvoiceCreditCapacity(
      invoiceId,
      invoice,
      (appliedCredits ?? []).map((c) => Number(c.total))
    )

    return NextResponse.json(capacity)
  } catch (error: unknown) {
    console.error("GET /api/invoices/[id]/credit-capacity:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
