import { NextRequest, NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { logReconciliationMismatch } from "@/lib/accounting/reconciliation/mismatch-logger"
import { performServiceJobReversal } from "@/lib/service/jobReversal"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import {
  computeInvoiceCreditCapacity,
  formatCreditCapacityExceededError,
} from "@/lib/creditNotes/invoiceCreditCapacity"
import { fireAfterAccountingPost } from "@/lib/server/fireAfterAccountingPost"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: creditNote, error } = await supabase
      .from("credit_notes")
      .select(
        `
        id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction,
        invoices (
          id,
          invoice_number,
          total,
          customers (
            id,
            name,
            email,
            phone,
            whatsapp_phone
          )
        )
      `
      )
      .eq("id", creditNoteId)
      .is("deleted_at", null)
      .maybeSingle()

    if (error || !creditNote) {
      return NextResponse.json(
        { error: "Credit note not found" },
        { status: 404 }
      )
    }

    // Service owner / business access: allow if user owns business or is in business_users
    const businessId = (creditNote as { business_id?: string }).business_id
    if (businessId) {
      const { data: business } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", businessId)
        .maybeSingle()
      const isOwner = business?.owner_id === user.id
      if (!isOwner) {
        const { data: member } = await supabase
          .from("business_users")
          .select("id")
          .eq("business_id", businessId)
          .eq("user_id", user.id)
          .maybeSingle()
        if (!member) {
          return NextResponse.json(
            { error: "You do not have access to this credit note" },
            { status: 403 }
          )
        }
      }
    }

    // Get credit note items
    const { data: items, error: itemsError } = await supabase
      .from("credit_note_items")
      .select(
        `
        *,
        invoice_items (
          id,
          description
        )
      `
      )
      .eq("credit_note_id", creditNoteId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching credit note items:", itemsError)
    }

    return NextResponse.json({
      creditNote,
      items: items || [],
    })
  } catch (error: any) {
    console.error("Error fetching credit note:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const creditNoteId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { status, reason, notes } = body

    const { data: existingCreditNote, error: fetchError } = await supabase
      .from("credit_notes")
      .select("id, invoice_id, status, business_id")
      .eq("id", creditNoteId)
      .is("deleted_at", null)
      .maybeSingle()

    if (fetchError || !existingCreditNote) {
      return NextResponse.json(
        { error: "Credit note not found" },
        { status: 404 }
      )
    }

    // Service owner / business access
    const businessId = existingCreditNote.business_id
    if (businessId) {
      const { data: business } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", businessId)
        .maybeSingle()
      const isOwner = business?.owner_id === user.id
      if (!isOwner) {
        const { data: member } = await supabase
          .from("business_users")
          .select("id")
          .eq("business_id", businessId)
          .eq("user_id", user.id)
          .maybeSingle()
        if (!member) {
          return NextResponse.json(
            { error: "You do not have access to this credit note" },
            { status: 403 }
          )
        }
      }

      const writeDenied = await enforceServiceIndustryFinancialWrite(
        supabase,
        user.id,
        businessId,
        "starter"
      )
      if (writeDenied) return writeDenied
    }

    // APPLY validation: cap credit notes to invoice gross (minus other applied credit notes).
    // Accounting rule: a paid invoice may still be credited; settlement/refund is handled separately.
    // Source of truth: never use stored balance fields.
    // Float/rounding: compute in cents; reject only when credit exceeds remaining creditable amount + tolerance.
    if (status === "applied" && existingCreditNote.status !== "applied") {
      const safeNumber = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

      const { data: invoice } = await supabase
        .from("invoices")
        .select("total, subtotal, total_tax")
        .eq("id", existingCreditNote.invoice_id)
        .single()

      // STEP 1 — Hard guard: invoice must exist
      if (!invoice) {
        return NextResponse.json(
          { error: "Invoice not found or inaccessible" },
          { status: 404 }
        )
      }

      const { data: existingCredits } = await supabase
        .from("credit_notes")
        .select("id, total")
        .eq("invoice_id", existingCreditNote.invoice_id)
        .eq("status", "applied")
        .is("deleted_at", null)

      const { data: creditNote } = await supabase
        .from("credit_notes")
        .select("total")
        .eq("id", creditNoteId)
        .single()

      const otherAppliedTotals = (existingCredits ?? [])
        .filter((c: { id: string }) => c.id !== creditNoteId)
        .map((c: { total?: unknown }) => Number(c.total))

      const capacity = computeInvoiceCreditCapacity(
        existingCreditNote.invoice_id,
        invoice,
        otherAppliedTotals
      )

      if (capacity.invoiceGross <= 0 || !Number.isFinite(capacity.invoiceGross)) {
        return NextResponse.json(
          { error: "Invoice total is invalid or zero — cannot apply credit note" },
          { status: 400 }
        )
      }

      const creditAmount = safeNumber(creditNote?.total)
      const creditRounded = Math.round(creditAmount * 100) / 100

      if (process.env.NODE_ENV === "development") {
        console.log("CN APPLY CREDIT CAP VALIDATION", {
          invoiceGross: capacity.invoiceGross,
          totalCredits: capacity.appliedCreditsTotal,
          remainingCreditable: capacity.remainingCreditable,
          creditRounded,
        })
      }

      // Reject only when credit exceeds remaining creditable amount by more than rounding tolerance (0.01)
      const TOLERANCE = 0.01
      if (creditNote && creditRounded > capacity.remainingCreditable + TOLERANCE) {
        const logCtx = {
          invoice_total: capacity.invoiceGross,
          total_credits: capacity.appliedCreditsTotal,
          calculated_remaining_creditable: capacity.remainingCreditable,
          credit_note_amount: creditAmount,
          invoice_id: existingCreditNote.invoice_id,
        }
        console.warn("[credit-notes/apply] Credit note exceeds invoice credit cap", logCtx)
        return NextResponse.json(
          {
            error: formatCreditCapacityExceededError(creditRounded, capacity.remainingCreditable),
          },
          { status: 400 }
        )
      }

      // Defensive log on success (can be removed or downgraded in production)
      if (creditNote && process.env.NODE_ENV !== "production") {
        console.info("[credit-notes/apply] Credit cap check passed", {
          invoice_total: capacity.invoiceGross,
          total_credits: capacity.appliedCreditsTotal,
          calculated_remaining_creditable: capacity.remainingCreditable,
          credit_note_amount: creditAmount,
        })
      }

      // Ledger reconciliation check (VALIDATE, zero tolerance) — observe only, do not block
      const businessIdForReconcile = (existingCreditNote as { business_id?: string }).business_id
      if (businessIdForReconcile && existingCreditNote.invoice_id) {
        try {
          const engine = createReconciliationEngine(supabase)
          const result = await engine.reconcileInvoice(
            { businessId: businessIdForReconcile, invoiceId: existingCreditNote.invoice_id },
            ReconciliationContext.VALIDATE
          )
          if (result.status !== ReconciliationStatus.OK) {
            logReconciliationMismatch(result)
          }
        } catch (reconcileErr) {
          console.warn("[credit-notes/[id]] reconcileInvoice failed (non-blocking):", reconcileErr)
        }
      }
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (status) {
      if (!["draft", "issued", "applied"].includes(status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        )
      }
      updateData.status = status
    }
    if (reason !== undefined) updateData.reason = reason
    if (notes !== undefined) updateData.notes = notes

    const { data: updatedRow, error } = await supabase
      .from("credit_notes")
      .update(updateData)
      .eq("id", creditNoteId)
      .select("id, business_id, invoice_id, credit_number, date, reason, subtotal, nhil, getfund, covid, vat, total_tax, total, status, notes, public_token, created_at, updated_at, deleted_at, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction")
      .maybeSingle()

    if (error) {
      console.error("Error updating credit note:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Service: when credit note is applied, if invoice is linked to a cancelled job with materials not yet reversed, run reversal
    const creditNote = updatedRow ?? { ...existingCreditNote, ...updateData }
    if (creditNote && (creditNote as { status?: string }).status === "applied" && existingCreditNote.invoice_id && businessId) {
      const { data: linkedJobs } = await supabase
        .from("service_jobs")
        .select("id, status, materials_reversed")
        .eq("invoice_id", existingCreditNote.invoice_id)
        .eq("business_id", businessId)
      const jobs = (linkedJobs || []) as { id: string; status: string; materials_reversed?: boolean }[]
      for (const j of jobs) {
        if (j.status === "cancelled" && j.materials_reversed !== true) {
          const rev = await performServiceJobReversal(supabase, businessId, j.id)
          if (rev.error && process.env.NODE_ENV !== "production") {
            console.warn("[credit-notes] Service job reversal on apply:", rev.error)
          }
        }
      }
    }
    if (
      creditNote &&
      (creditNote as { status?: string }).status === "applied" &&
      businessId
    ) {
      fireAfterAccountingPost({
        businessId,
        journalDate: (creditNote as { date?: string }).date ?? undefined,
        source: "credit_note_apply",
        supabase,
        scheduleBackground: (p) => waitUntil(p),
      })
    }

    return NextResponse.json({ creditNote })
  } catch (error: any) {
    console.error("Error updating credit note:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

