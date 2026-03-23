/**
 * GET /api/dashboard/service-activity?business_id=...&limit=10
 *
 * Returns recent journal entries as activity feed items.
 * For entries linked to an invoice, bill, or expense, the item's
 * currencyCode and amount are pulled from the source document so
 * FX documents (e.g. a USD invoice) correctly show their original
 * currency rather than the home-currency journal line total.
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

interface DocCurrency {
  currency_code: string | null
  total: number | null
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

    // ── 1. Fetch recent journal entries ───────────────────────────────────────
    const { data: entries } = await supabase
      .from("journal_entries")
      .select(`
        id, date, created_at, description, source_type, reference_type, reference_id,
        journal_entry_lines(debit, credit)
      `)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit)

    // ── 2. Collect reference IDs by document type ─────────────────────────────
    const invoiceIds: string[] = []
    const billIds: string[]    = []
    const expenseIds: string[] = []

    for (const e of entries ?? []) {
      const refId = (e as Record<string, unknown>).reference_id as string | null
      const refType = ((e as Record<string, unknown>).reference_type as string | null)?.toLowerCase()
      if (!refId) continue
      if (refType === "invoice")   invoiceIds.push(refId)
      else if (refType === "bill") billIds.push(refId)
      else if (refType === "expense") expenseIds.push(refId)
    }

    // ── 3. Batch-fetch currency info from source documents ────────────────────
    const [{ data: invDocs }, { data: billDocs }, { data: expDocs }] = await Promise.all([
      invoiceIds.length
        ? supabase.from("invoices").select("id, currency_code, total").in("id", invoiceIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
      billIds.length
        ? supabase.from("bills").select("id, currency_code, total").in("id", billIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
      expenseIds.length
        ? supabase.from("expenses").select("id, currency_code, total").in("id", expenseIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
    ])

    // Unified lookup map: document_id → { currency_code, total }
    const docMap = new Map<string, DocCurrency>()
    for (const d of [...(invDocs ?? []), ...(billDocs ?? []), ...(expDocs ?? [])]) {
      docMap.set(d.id, { currency_code: d.currency_code, total: d.total })
    }

    // ── 4. Build activity items ───────────────────────────────────────────────
    const items = (entries ?? []).map((e: Record<string, unknown>) => {
      const lines = (e.journal_entry_lines as { debit: unknown; credit: unknown }[] | null) ?? []
      const totalDebits  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0)
      const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
      const journalAmount = Math.round(Math.max(totalDebits, totalCredits) * 100) / 100

      const srcRaw = ((e.source_type ?? e.reference_type ?? "journal") as string).toLowerCase()
      const type: ActivityType = SOURCE_TYPE_MAP[srcRaw] ?? "expense"

      const refId = e.reference_id as string | null

      // Prefer source-document currency so FX invoices/bills/expenses show
      // their original currency (e.g. USD 1,000 not GHS 10,910).
      const doc = refId ? docMap.get(refId) : null
      const currencyCode: string | undefined = doc?.currency_code ?? undefined
      const amount = doc?.total != null
        ? Math.round(doc.total * 100) / 100
        : journalAmount

      let href: string | undefined
      if (e.source_type === "invoice" && refId) href = `/service/invoices/${refId}`
      else if ((e.source_type === "bill" || e.source_type === "expense") && refId)
        href = `/service/expenses/${refId}`

      const rawDesc = e.description as string | null
      const description =
        rawDesc ||
        (e.reference_type
          ? `${(e.reference_type as string).replace(/_/g, " ")} entry`
          : "Journal entry")

      return {
        id: e.id as string,
        type,
        description,
        amount,
        currencyCode,           // undefined → feed falls back to business default
        timestamp: e.created_at as string,
        href,
      }
    })

    return NextResponse.json({ items })
  } catch (err) {
    console.error("service-activity error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
