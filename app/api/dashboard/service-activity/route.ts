/**
 * GET /api/dashboard/service-activity?business_id=...&limit=10
 *
 * Read-only. Returns recent journal entries as activity feed items.
 * Maps source_type to activity type. No schema changes.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

type ActivityType = "invoice" | "expense" | "payment" | "customer"

const SOURCE_TYPE_MAP: Record<string, ActivityType> = {
  invoice: "invoice",
  credit_note: "invoice",
  bill: "expense",
  expense: "expense",
  purchase: "expense",
  payment: "payment",
  receipt: "payment",
  customer_payment: "payment",
  journal: "expense",
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) return NextResponse.json({ error: "Missing business_id" }, { status: 400 })

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10))

    const { data: entries } = await supabase
      .from("journal_entries")
      .select(`
        id, date, description, source_type, reference_type, reference_id,
        journal_entry_lines(debit, credit)
      `)
      .eq("business_id", businessId)
      .order("date", { ascending: false })
      .limit(limit)

    const items = (entries ?? []).map((e: Record<string, unknown>) => {
      const lines = (e.journal_entry_lines as { debit: unknown; credit: unknown }[] | null) ?? []
      const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
      const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
      const amount = Math.round(Math.max(totalDebits, totalCredits) * 100) / 100

      const srcRaw = ((e.source_type ?? e.reference_type ?? "journal") as string).toLowerCase()
      const type: ActivityType = SOURCE_TYPE_MAP[srcRaw] ?? "expense"

      let href: string | undefined
      const refId = e.reference_id as string | null
      if (e.source_type === "invoice" && refId) href = `/service/invoices/${refId}`
      else if ((e.source_type === "bill" || e.source_type === "expense") && refId)
        href = `/service/expenses/${refId}`

      const rawDesc = e.description as string | null
      const description =
        rawDesc ||
        (e.reference_type ? `${(e.reference_type as string).replace(/_/g, " ")} entry` : "Journal entry")

      return {
        id: e.id as string,
        type,
        description,
        amount,
        timestamp: e.date as string,
        href,
      }
    })

    return NextResponse.json({ items })
  } catch (err) {
    console.error("service-activity error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
