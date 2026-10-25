import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { mapVatPaymentRpcError } from "@/lib/vat/vatReturnPayment"

type RouteParams = Promise<{ id: string }> | { id: string }

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  try {
    const { id: returnId } = await Promise.resolve(params)
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: vatReturn, error: loadError } = await supabase
      .from("vat_returns")
      .select(
        "id,business_id,status,payment_journal_entry_id"
      )
      .eq("id", returnId)
      .is("deleted_at", null)
      .maybeSingle()

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 })
    }
    if (!vatReturn) {
      return NextResponse.json({ error: "VAT filing not found" }, { status: 404 })
    }

    const denied = await enforceServiceWorkspaceAccess({
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

    const paymentDate = nonEmpty((body as Record<string, unknown>).payment_date)
    const paymentAccountId = nonEmpty(
      (body as Record<string, unknown>).payment_account_id
    )
    const paymentReference = nonEmpty(
      (body as Record<string, unknown>).payment_reference
    )

    if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json(
        { error: "payment_date must be YYYY-MM-DD" },
        { status: 400 }
      )
    }
    if (!paymentAccountId) {
      return NextResponse.json(
        { error: "payment_account_id is required" },
        { status: 400 }
      )
    }
    if (paymentReference && paymentReference.length > 200) {
      return NextResponse.json(
        { error: "payment_reference must be 200 characters or fewer" },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "post_vat_return_payment_atomic",
      {
        p_vat_return_id: returnId,
        p_payment_date: paymentDate,
        p_payment_account_id: paymentAccountId,
        p_payment_reference: paymentReference,
      }
    )

    if (rpcError) {
      const mapped = mapVatPaymentRpcError(rpcError)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    return NextResponse.json(
      {
        success: true,
        ...((result as Record<string, unknown> | null) || {}),
      },
      { status: (result as { reused?: boolean } | null)?.reused ? 200 : 201 }
    )
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error"
    console.error("[VAT payment] POST failed:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
