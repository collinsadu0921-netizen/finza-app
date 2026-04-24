/**
 * GET /api/wht/receivable?business_id=xxx
 *
 * Customer WHT receivable: invoices with wht_receivable_* plus payments.wht_amount.
 * Tenant-scoped; same tier gate as supplier WHT (/api/wht).
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import type { WhtReceivableDeductionStatus, WhtReceivableRow } from "@/lib/wht/receivableTypes"

const EPS = 0.02

function deductionStatus(expected: number, deductedTotal: number): WhtReceivableDeductionStatus {
  if (expected <= EPS) return "pending"
  if (deductedTotal <= EPS) return "pending"
  if (deductedTotal + EPS < expected) return "partially_deducted"
  return "deducted"
}

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

    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select(
        `
        id,
        invoice_number,
        issue_date,
        total,
        status,
        wht_receivable_applicable,
        wht_receivable_rate,
        wht_receivable_amount,
        customer_id,
        customers ( name )
      `
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .or("wht_receivable_applicable.eq.true,wht_receivable_amount.gt.0")
      .order("issue_date", { ascending: false })

    if (invErr) {
      console.error("[wht/receivable] invoices", invErr)
      return NextResponse.json({ error: invErr.message }, { status: 500 })
    }

    const invList = invoices ?? []
    if (invList.length === 0) {
      return NextResponse.json({
        rows: [] as WhtReceivableRow[],
        summary: { total_expected: 0, total_deducted: 0, total_outstanding: 0 },
      })
    }

    const invoiceIds = invList.map((i) => i.id as string)

    const { data: payments, error: payErr } = await supabase
      .from("payments")
      .select("id, invoice_id, date, reference, amount, wht_amount, method")
      .eq("business_id", businessId)
      .in("invoice_id", invoiceIds)
      .is("deleted_at", null)
      .order("date", { ascending: true })

    if (payErr) {
      console.error("[wht/receivable] payments", payErr)
      return NextResponse.json({ error: payErr.message }, { status: 500 })
    }

    const byInvoice = new Map<string, typeof payments>()
    for (const p of payments ?? []) {
      const iid = p.invoice_id as string
      if (!byInvoice.has(iid)) byInvoice.set(iid, [])
      byInvoice.get(iid)!.push(p)
    }

    const rows: WhtReceivableRow[] = []
    let totalExpected = 0
    let totalDeducted = 0

    for (const inv of invList) {
      const expected = Number(inv.wht_receivable_amount ?? 0) || 0
      const plist = byInvoice.get(inv.id as string) ?? []
      const deductedTotal = plist.reduce((s, p) => s + (Number(p.wht_amount) || 0), 0)
      const outstanding = Math.max(0, Math.round((expected - deductedTotal) * 100) / 100)
      const status = deductionStatus(expected, deductedTotal)

      totalExpected += expected
      totalDeducted += deductedTotal

      const customerName =
        (inv.customers as { name?: string } | null)?.name?.trim() ||
        (inv.customer_id ? "Customer" : "Walk-in")

      if (plist.length === 0) {
        rows.push({
          invoice_id: inv.id as string,
          invoice_number: String(inv.invoice_number),
          customer_name: customerName,
          issue_date: String(inv.issue_date),
          invoice_total: Number(inv.total) || 0,
          expected_wht: expected,
          wht_outstanding: outstanding,
          deduction_status: status,
          invoice_status: String(inv.status),
          payment_id: null,
          payment_date: null,
          payment_reference: null,
          payment_method: null,
          wht_on_payment: null,
        })
        continue
      }

      for (const p of plist) {
        const whtOn = Number(p.wht_amount) || 0
        rows.push({
          invoice_id: inv.id as string,
          invoice_number: String(inv.invoice_number),
          customer_name: customerName,
          issue_date: String(inv.issue_date),
          invoice_total: Number(inv.total) || 0,
          expected_wht: expected,
          wht_outstanding: outstanding,
          deduction_status: status,
          invoice_status: String(inv.status),
          payment_id: p.id as string,
          payment_date: String(p.date),
          payment_reference: p.reference ? String(p.reference) : null,
          payment_method: p.method ? String(p.method) : null,
          wht_on_payment: whtOn,
        })
      }
    }

    const summary = {
      total_expected: Math.round(totalExpected * 100) / 100,
      total_deducted: Math.round(totalDeducted * 100) / 100,
      total_outstanding: Math.max(0, Math.round((totalExpected - totalDeducted) * 100) / 100),
    }

    return NextResponse.json({ rows, summary })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
