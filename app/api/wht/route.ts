/**
 * GET  /api/wht?business_id=xxx   — list WHT-applicable bills with remittance status
 * POST /api/wht                   — mark one or more bills' WHT as remitted
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

    if (!businessId) {
      return NextResponse.json({ error: "business_id required" }, { status: 400 })
    }

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

    const body = await request.json()
    const { business_id, bill_ids, remittance_date, reference, notes, payment_account = "1010" } = body

    if (!business_id || !bill_ids?.length || !remittance_date) {
      return NextResponse.json({ error: "business_id, bill_ids, and remittance_date are required" }, { status: 400 })
    }

    // Fetch bills to get their WHT amounts
    const { data: bills, error: fetchErr } = await supabase
      .from("bills")
      .select("id, wht_amount, wht_applicable, wht_remitted_at")
      .in("id", bill_ids)
      .eq("business_id", business_id)
      .eq("wht_applicable", true)
      .is("wht_remitted_at", null)

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!bills?.length) return NextResponse.json({ error: "No eligible bills found" }, { status: 400 })

    const totalWHT = bills.reduce((s, b) => s + Number(b.wht_amount), 0)

    // Create remittance record
    const { data: remittance, error: remErr } = await supabase
      .from("wht_remittances")
      .insert({
        business_id,
        remittance_date,
        amount: totalWHT,
        reference: reference || null,
        notes: notes || null,
        created_by: user?.id || null,
      })
      .select()
      .single()

    if (remErr) return NextResponse.json({ error: remErr.message }, { status: 500 })

    // Link bills to remittance
    const links = bills.map(b => ({
      remittance_id: remittance.id,
      bill_id: b.id,
      wht_amount: Number(b.wht_amount),
    }))
    await supabase.from("wht_remittance_bills").insert(links)

    // Mark bills as remitted
    await supabase
      .from("bills")
      .update({
        wht_remitted_at: new Date().toISOString(),
        wht_remittance_ref: reference || null,
      })
      .in("id", bill_ids)

    // Post to ledger: Dr WHT Payable (2150) / Cr Bank (1010)
    const { data: jeId, error: ledgerErr } = await supabase
      .rpc("post_wht_remittance_to_ledger", {
        p_remittance_id: remittance.id,
        p_payment_account_code: payment_account,
      })

    if (ledgerErr) {
      console.error("WHT ledger post error:", ledgerErr)
      // Non-fatal: remittance is recorded, ledger will be out of sync but recoverable
    }

    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "wht.remitted",
      entityType: "wht_remittance",
      entityId: remittance.id,
      oldValues: null,
      newValues: { bill_ids, totalWHT, remittance_date, reference },
      request,
    })

    return NextResponse.json({ success: true, remittance, total_remitted: totalWHT })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
