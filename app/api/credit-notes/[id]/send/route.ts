import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog, getIpAddress, getUserAgent } from "@/lib/auditLog"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { sendCreditNoteEmail } from "@/lib/email/sendCreditNoteEmail"

/**
 * POST /api/credit-notes/[id]/send
 *
 * Send credit note via email. Updates status draft → issued (idempotent if already issued).
 * Does NOT post to ledger; ledger posting occurs only when status becomes "applied" (trigger_post_credit_note).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams?.id

    if (!creditNoteId) {
      return NextResponse.json(
        { error: "Credit note ID is required" },
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

    const body = await request.json().catch(() => ({}))
    const emailOverride = typeof body?.email === "string" ? body.email.trim() : null

    // Load credit note scoped to session business only (no body.business_id)
    const { data: creditNote, error: cnError } = await supabase
      .from("credit_notes")
      .select(
        `
        id,
        business_id,
        credit_number,
        date,
        reason,
        notes,
        subtotal,
        total_tax,
        total,
        status,
        public_token,
        invoice_id,
        invoices (
          id,
          invoice_number,
          total,
          customers (
            id,
            name,
            email,
            phone
          )
        )
      `
      )
      .eq("id", creditNoteId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (cnError || !creditNote) {
      return NextResponse.json(
        {
          success: false,
          error: "Credit note not found or you do not have access to it.",
          message: "Credit note not found"
        },
        { status: 403 }
      )
    }

    // Block send when already applied (ledger already posted)
    if (creditNote.status === "applied") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot send an applied credit note. It has already been posted to the ledger.",
          message: "Invalid status for send"
        },
        { status: 400 }
      )
    }

    // Accounting readiness guard (same pattern as invoice send)
    const { ready } = await checkAccountingReadiness(supabase, business.id)
    if (!ready) {
      return NextResponse.json(
        {
          success: false,
          error: "Accounting is not set up for this business. Please complete accounting setup before sending credit notes.",
          message: "Accounting not ready"
        },
        { status: 400 }
      )
    }

    const customer = (creditNote.invoices as { customers?: { email?: string; name?: string } | null } | null)?.customers
    const recipientEmail = emailOverride || customer?.email
    if (!recipientEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "Customer email is not available. Add an email to the customer profile or provide an email.",
          message: "Email required"
        },
        { status: 400 }
      )
    }

    const businessName = (business as { legal_name?: string; trading_name?: string }).trading_name
      || (business as { legal_name?: string }).legal_name
      || "Business"
    const invoiceRef = (creditNote.invoices as { invoice_number?: string; total?: number } | null)?.invoice_number ?? ""
    const creditAmount = Number(creditNote.total ?? 0)
    const reason = creditNote.reason ?? ""

    await sendCreditNoteEmail({
      to: recipientEmail,
      businessName,
      creditNumber: creditNote.credit_number,
      invoiceReference: invoiceRef,
      creditAmount,
      reason,
      customerName: customer?.name ?? "Customer",
      publicUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/credit-public/${creditNote.public_token ?? ""}`,
      businessId: business.id,
      creditNoteId,
      industry: (business as { industry?: string | null }).industry ?? null,
    })

    // Update status to issued only if currently draft (idempotent: issued → issued is no-op)
    if (creditNote.status === "draft") {
      const { error: updateError } = await supabase
        .from("credit_notes")
        .update({ status: "issued" })
        .eq("id", creditNoteId)
        .eq("business_id", business.id)

      if (updateError) {
        console.error("Credit note send: failed to update status", updateError)
        return NextResponse.json(
          { success: false, error: "Failed to update credit note status", message: updateError.message },
          { status: 500 }
        )
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.log("Credit Note sent — ledger NOT posted")
    }

    try {
      await createAuditLog({
        businessId: creditNote.business_id,
        userId: user.id,
        actionType: "credit_note.sent_email",
        entityType: "credit_note",
        entityId: creditNoteId,
        newValues: { recipient_email: recipientEmail, status: creditNote.status === "draft" ? "issued" : "issued" },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        description: `Credit note ${creditNote.credit_number} sent via email to ${recipientEmail}`,
      })
    } catch (auditErr) {
      console.error("Credit note send: audit log failed", auditErr)
    }

    return NextResponse.json({
      success: true,
      status: "issued",
      message: "Credit note sent successfully",
    })
  } catch (err: unknown) {
    console.error("Credit note send error:", err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
        message: "Failed to send credit note"
      },
      { status: 500 }
    )
  }
}
