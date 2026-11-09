/**
 * GET  /api/wht?business_id=xxx   — list WHT-applicable bills with remittance status
 * POST /api/wht                   — mark one or more bills' WHT as remitted
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"
import { requireAccountingWriteRole } from "@/lib/accounting/requireAccountingWriteRole"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

    if (!businessId) {
      return NextResponse.json({ error: "business_id required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId,
      minTier: "professional",
    })
    if (denied) return denied

    const { data: bills, error } = await supabase
      .from("bills")
      .select("id, bill_number, supplier_name, issue_date, total, wht_rate, wht_amount, wht_remitted_at, wht_remittance_ref, status")
      .eq("business_id", businessId)
      .eq("wht_applicable", true)
      .order("issue_date", { ascending: false })

    if (error) {
      console.error("WHT list error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const pending = (bills ?? []).filter(b => !b.wht_remitted_at)
    const remitted = (bills ?? []).filter(b => b.wht_remitted_at)
    const totalPending = pending.reduce((s, b) => s + Number(b.wht_amount), 0)

    return NextResponse.json({ bills: bills ?? [], pending, remitted, totalPending })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { business_id, bill_ids, remittance_date, reference, notes, payment_account = "1010" } = body

    if (!business_id || !Array.isArray(bill_ids) || bill_ids.length === 0 || !remittance_date) {
      return NextResponse.json({ error: "business_id, bill_ids, and remittance_date are required" }, { status: 400 })
    }

    const roleDenied = await requireAccountingWriteRole(
      supabase,
      user.id,
      business_id
    )
    if (roleDenied) {
      return NextResponse.json(
        { success: false, error: roleDenied.error, code: roleDenied.code },
        { status: roleDenied.status }
      )
    }

    const deniedPost = await enforceServiceWorkspaceWriteAccess({
      supabase,
      userId: user.id,
      businessId: business_id,
      minTier: "professional",
    })
    if (deniedPost) return deniedPost

    // One atomic RPC records the remittance, links and marks the source bills,
    // enforces the period lock, and posts the journal through the canonical
    // posting infrastructure. A failure rolls back every step.
    const { data, error } = await supabase.rpc("create_wht_remittance_atomic", {
      p_business_id: business_id,
      p_bill_ids: bill_ids,
      p_remittance_date: remittance_date,
      p_reference: reference || null,
      p_notes: notes || null,
      p_payment_account_code: payment_account || "1010",
    })

    if (error) {
      const message = String(error.message || "")
      console.error("WHT remittance error:", message)

      if (message.includes("WHT_REMITTANCE_NOT_AUTHORIZED")) {
        return NextResponse.json({ success: false, error: message }, { status: 403 })
      }
      if (
        message.includes("WHT_REMITTANCE_ALREADY_REMITTED") ||
        message.includes("WHT_REMITTANCE_PARTIAL_ALREADY_REMITTED") ||
        message.includes("WHT_REMITTANCE_LEGACY_WITHOUT_JOURNAL")
      ) {
        return NextResponse.json({ success: false, error: message }, { status: 409 })
      }
      if (message.includes("WHT_REMITTANCE_PERIOD_LOCKED")) {
        return NextResponse.json({ success: false, error: message }, { status: 409 })
      }
      if (
        message.includes("WHT_REMITTANCE_INVALID") ||
        message.includes("WHT_REMITTANCE_NO_BILLS") ||
        message.includes("WHT_REMITTANCE_BILL_NOT_FOUND") ||
        message.includes("WHT_REMITTANCE_BILL_NOT_POSTED") ||
        message.includes("WHT_REMITTANCE_BILL_NOT_ELIGIBLE")
      ) {
        return NextResponse.json({ success: false, error: message }, { status: 400 })
      }

      return NextResponse.json({ success: false, error: message }, { status: 500 })
    }

    const result = (data || {}) as {
      reused?: boolean
      remittance_id?: string
      journal_entry_id?: string
      amount?: number
      reference?: string | null
      bill_ids?: string[]
    }

    if (!result.reused && (!result.remittance_id || !result.journal_entry_id)) {
      return NextResponse.json(
        {
          success: false,
          error: "WHT remittance did not return a linked journal. Nothing was committed.",
        },
        { status: 500 }
      )
    }

    const remittance = {
      id: result.remittance_id,
      business_id,
      remittance_date,
      amount: Number(result.amount || 0),
      reference: result.reference ?? (reference || null),
      notes: notes || null,
      journal_entry_id: result.journal_entry_id,
    }

    if (!result.reused) {
      await createAuditLog({
        businessId: business_id,
        userId: user?.id || null,
        actionType: "wht.remitted",
        entityType: "wht_remittance",
        entityId: result.remittance_id,
        oldValues: null,
        newValues: {
          bill_ids,
          totalWHT: result.amount,
          remittance_date,
          reference,
          journal_entry_id: result.journal_entry_id,
        },
        request,
      })
    }

    return NextResponse.json({
      success: true,
      reused: Boolean(result.reused),
      remittance,
      total_remitted: Number(result.amount || 0),
      journal_entry_id: result.journal_entry_id,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
