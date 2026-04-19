import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

/**
 * GET /api/retail/reports/register-sessions
 * Operational register session report (no ledger reads).
 * Query: start_date, end_date (YYYY-MM-DD), optional store_id (owner/admin only; managers use assigned store).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
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
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const storeIdParam = searchParams.get("store_id")

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "start_date and end_date are required (YYYY-MM-DD)" }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 })
    }
    if (start > end) {
      return NextResponse.json({ error: "start_date must be on or before end_date" }, { status: 400 })
    }

    end.setHours(23, 59, 59, 999)
    const startIso = new Date(startDate)
    startIso.setHours(0, 0, 0, 0)
    const endIso = end.toISOString()
    const startIsoStr = startIso.toISOString()

    const { data: bu, error: buErr } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (buErr || !bu?.role) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const role = bu.role as string
    if (!["owner", "admin", "manager", "employee"].includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    let effectiveStoreId: string | null = null
    if (role === "manager") {
      const { data: urow } = await supabase.from("users").select("store_id").eq("id", user.id).maybeSingle()
      effectiveStoreId = urow?.store_id ?? null
      if (!effectiveStoreId) {
        return NextResponse.json({ error: "Store assignment required" }, { status: 403 })
      }
    } else {
      effectiveStoreId = storeIdParam && storeIdParam !== "all" ? storeIdParam : null
    }

    let sessionQuery = supabase
      .from("cashier_sessions")
      .select(
        `
        id,
        register_id,
        user_id,
        store_id,
        business_id,
        status,
        started_at,
        ended_at,
        opening_float,
        opening_cash,
        closing_amount,
        closing_cash,
        total_drops,
        supervised_actions_count,
        registers:register_id ( id, name ),
        stores:store_id ( name ),
        users:user_id ( full_name, email )
      `,
      )
      .eq("business_id", business.id)
      .gte("started_at", startIsoStr)
      .lte("started_at", endIso)
      .order("started_at", { ascending: false })
      .limit(400)

    if (effectiveStoreId) {
      sessionQuery = sessionQuery.eq("store_id", effectiveStoreId)
    }

    const { data: sessions, error: sessErr } = await sessionQuery

    if (sessErr) {
      console.error("register-sessions query error:", sessErr)
      return NextResponse.json({ error: sessErr.message || "Failed to load sessions" }, { status: 500 })
    }

    const sessionList = sessions || []
    const sessionIds = sessionList.map((s: { id: string }) => s.id)
    if (sessionIds.length === 0) {
      return NextResponse.json({
        period: { start_date: startDate, end_date: endDate },
        sessions: [],
      })
    }

    const { data: salesRows } = await supabase
      .from("sales")
      .select("cashier_session_id, payment_status, amount")
      .eq("business_id", business.id)
      .in("cashier_session_id", sessionIds)

    const saleAgg = new Map<
      string,
      { paid: number; paidAmount: number; refunded: number; other: number }
    >()
    for (const sid of sessionIds) {
      saleAgg.set(sid, { paid: 0, paidAmount: 0, refunded: 0, other: 0 })
    }
    for (const row of salesRows || []) {
      const sid = (row as { cashier_session_id: string | null }).cashier_session_id
      if (!sid || !saleAgg.has(sid)) continue
      const bucket = saleAgg.get(sid)!
      const ps = String((row as { payment_status?: string }).payment_status || "")
      const amt = Number((row as { amount?: unknown }).amount) || 0
      if (ps === "paid") {
        bucket.paid += 1
        bucket.paidAmount += amt
      } else if (ps === "refunded") {
        bucket.refunded += 1
      } else {
        bucket.other += 1
      }
    }

    const { data: variances } = await supabase
      .from("register_variances")
      .select("session_id, expected, counted, difference, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })

    const varianceBySession = new Map<string, { expected: number; counted: number; difference: number }>()
    for (const v of variances || []) {
      const row = v as { session_id: string; expected: number; counted: number; difference: number }
      if (!varianceBySession.has(row.session_id)) {
        varianceBySession.set(row.session_id, {
          expected: Number(row.expected),
          counted: Number(row.counted),
          difference: Number(row.difference),
        })
      }
    }

    const { data: drops } = await supabase.from("cash_drops").select("session_id, amount").in("session_id", sessionIds)

    const dropsSum = new Map<string, number>()
    for (const d of drops || []) {
      const row = d as { session_id: string; amount: number }
      const sid = row.session_id
      dropsSum.set(sid, (dropsSum.get(sid) || 0) + (Number(row.amount) || 0))
    }

    const sessionsOut = sessionList.map((s: any) => {
      const reg = s.registers as { name?: string } | null
      const st = s.stores as { name?: string } | null
      const u = s.users as { full_name?: string; email?: string } | null
      const agg = saleAgg.get(s.id) || { paid: 0, paidAmount: 0, refunded: 0, other: 0 }
      const opening = Number(s.opening_float ?? s.opening_cash ?? 0) || 0
      const closing = s.closing_cash != null ? Number(s.closing_cash) : s.closing_amount != null ? Number(s.closing_amount) : null
      const varianceRow = varianceBySession.get(s.id) || null
      const dropsTotal = dropsSum.get(s.id) || Number(s.total_drops || 0) || 0

      return {
        id: s.id,
        register_id: s.register_id,
        register_name: reg?.name || "Register",
        store_name: st?.name || null,
        cashier_name: u?.full_name || u?.email || "—",
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        opening_cash: opening,
        closing_cash_counted: closing,
        total_cash_drops: dropsTotal,
        supervised_actions_count: Number(s.supervised_actions_count || 0),
        paid_sales_count: agg.paid,
        paid_sales_total: agg.paidAmount,
        refunded_sales_count: agg.refunded,
        other_status_sales_count: agg.other,
        register_variance: varianceRow,
      }
    })

    return NextResponse.json({
      period: { start_date: startDate, end_date: endDate },
      store_id: effectiveStoreId,
      sessions: sessionsOut,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
