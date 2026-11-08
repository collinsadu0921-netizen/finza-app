import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceWriteAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { createAuditLog } from "@/lib/auditLog"

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * POST /api/vat-returns/[id]/amend
 *
 * Creates an auditable amendment draft. For a paid filing, pass
 * `reverse_payment: true` with a reversal date and reason; the payment is
 * reversed by a new journal first, then the amendment draft is created.
 * Posted journals and the original filing are never modified in place.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: returnId } = await params
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: vatReturn, error: loadError } = await supabase
      .from("vat_returns")
      .select("id, business_id, status, payment_journal_entry_id")
      .eq("id", returnId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 })
    }
    if (!vatReturn) {
      return NextResponse.json({ error: "VAT filing not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceWriteAccess({
      supabase,
      userId: user.id,
      businessId: vatReturn.business_id,
      minTier: "professional",
    })
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const reason = nonEmpty((body as Record<string, unknown>).reason)
    const evidence = nonEmpty((body as Record<string, unknown>).evidence)
    const reversePayment = Boolean(
      (body as Record<string, unknown>).reverse_payment
    )
    const reversalDate = nonEmpty(
      (body as Record<string, unknown>).reversal_date
    )

    if (!reason) {
      return NextResponse.json(
        { error: "A reason is required for a VAT amendment." },
        { status: 400 }
      )
    }

    if (vatReturn.status === "paid" && reversePayment) {
      if (!reversalDate || !/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) {
        return NextResponse.json(
          { error: "reversal_date must be YYYY-MM-DD" },
          { status: 400 }
        )
      }

      const { data: reversal, error: reversalError } = await supabase.rpc(
        "reverse_vat_return_payment",
        {
          p_vat_return_id: returnId,
          p_reversal_date: reversalDate,
          p_reason: reason,
          p_evidence: evidence,
        }
      )
      if (reversalError) {
        const message = String(reversalError.message || "")
        const status = message.includes("VAT_REVERSAL_NOT_AUTHORIZED") ? 403 : 409
        return NextResponse.json(
          { error: message, code: message.split(":")[0] },
          { status }
        )
      }
    }

    const { data: amendment, error: amendmentError } = await supabase.rpc(
      "create_vat_return_amendment",
      {
        p_vat_return_id: returnId,
        p_reason: reason,
        p_evidence: evidence,
      }
    )

    if (amendmentError) {
      const message = String(amendmentError.message || "")
      const status = message.includes("NOT_AUTHORIZED") ? 403 : 409
      return NextResponse.json(
        { error: message, code: message.split(":")[0] },
        { status }
      )
    }

    await createAuditLog({
      businessId: vatReturn.business_id,
      userId: user.id,
      actionType: "vat_return.amended",
      entityType: "vat_return",
      entityId: returnId,
      oldValues: { status: vatReturn.status },
      newValues: {
        reason,
        evidence,
        amendment,
      },
      request,
      description: `VAT filing amended: ${reason}`,
    })

    return NextResponse.json({ success: true, amendment }, { status: 201 })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error"
    console.error("[VAT amendment] POST failed:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
