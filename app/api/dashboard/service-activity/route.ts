/**
 * GET /api/dashboard/service-activity?business_id=...&limit=10
 *
 * Returns a merged recent-activity feed: journal entries, outbound email lifecycle
 * events (when tagged with business_id), and inbound document emails.
 * Journal items linked to invoices/bills/expenses keep source-document currency for FX.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

type ActivityType = "invoice" | "expense" | "payment" | "customer" | "email"

type ActivityFeedItem = {
  id: string
  type: ActivityType
  description: string
  amount?: number | null
  currencyCode?: string
  timestamp: string
  href?: string
}

const SOURCE_TYPE_MAP: Record<string, Exclude<ActivityType, "email">> = {
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

function activityTimestampMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

function resendOutboundDescription(eventType: string): string {
  const labels: Record<string, string> = {
    "email.delivered": "Email delivered",
    "email.bounced": "Email bounced",
    "email.complained": "Email reported as spam",
    "email.opened": "Email opened",
    "email.clicked": "Link clicked in email",
  }
  return labels[eventType] ?? `Email: ${eventType.replace(/^email\./, "")}`
}

function devServiceActivityLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production") return
  console.info(`[service-activity] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

function inboundDescription(row: {
  subject: string | null
  processing_status: string
}): string {
  const subj = row.subject?.trim()
  const status =
    row.processing_status === "failed"
      ? " — processing failed"
      : row.processing_status === "processing" || row.processing_status === "pending"
        ? " — processing"
        : ""
  const head = "New document received"
  return subj ? `${head}: ${subj}${status}` : `${head}${status}`
}

async function buildJournalActivityItems(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  entries: Record<string, unknown>[]
): Promise<ActivityFeedItem[]> {
  const invoiceIds: string[] = []
  const billIds: string[] = []
  const expenseIds: string[] = []

  for (const e of entries) {
    const refId = e.reference_id as string | null
    const refType = (e.reference_type as string | null)?.toLowerCase()
    if (!refId) continue
    if (refType === "invoice") invoiceIds.push(refId)
    else if (refType === "bill") billIds.push(refId)
    else if (refType === "expense") expenseIds.push(refId)
  }

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

  const docMap = new Map<string, DocCurrency>()
  for (const d of [...(invDocs ?? []), ...(billDocs ?? []), ...(expDocs ?? [])]) {
    docMap.set(d.id, { currency_code: d.currency_code, total: d.total })
  }

  return entries.map((e) => {
    const lines = (e.journal_entry_lines as { debit: unknown; credit: unknown }[] | null) ?? []
    const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
    const journalAmount = Math.round(Math.max(totalDebits, totalCredits) * 100) / 100

    const srcRaw = ((e.source_type ?? e.reference_type ?? "journal") as string).toLowerCase()
    const type: Exclude<ActivityType, "email"> = SOURCE_TYPE_MAP[srcRaw] ?? "expense"

    const refId = e.reference_id as string | null
    const doc = refId ? docMap.get(refId) : null
    const currencyCode: string | undefined = doc?.currency_code ?? undefined
    const amount =
      doc?.total != null ? Math.round(doc.total * 100) / 100 : journalAmount

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
      currencyCode,
      timestamp: e.created_at as string,
      href,
    }
  })
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  const finish = (res: NextResponse) => {
    devServiceActivityLog("total route", routeT0)
    return res
  }

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      devServiceActivityLog("auth/business/access resolution", tAuth)
      return finish(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceActivityLog("auth/business/access resolution", tAuth)
      return finish(NextResponse.json({ error: "Missing business_id" }, { status: 400 }))
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      devServiceActivityLog("auth/business/access resolution", tAuth)
      return finish(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    }
    devServiceActivityLog("auth/business/access resolution", tAuth)

    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10) || 10))

    const [
      { data: entries, error: journalError },
      { data: resendRows, error: resendError },
      { data: inboundRows, error: inboundError },
    ] = await Promise.all([
      (async () => {
        const t0 = performance.now()
        const r = await supabase
          .from("journal_entries")
          .select(
            `
        id, date, created_at, description, source_type, reference_type, reference_id,
        journal_entry_lines(debit, credit)
      `
          )
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(limit)
        devServiceActivityLog("query: journal_entries", t0)
        return r
      })(),
      (async () => {
        const t0 = performance.now()
        const r = await supabase
          .from("resend_email_events")
          .select("id, event_type, event_occurred_at, received_at")
          .eq("business_id", businessId)
          .order("received_at", { ascending: false })
          .limit(limit)
        devServiceActivityLog("query: resend_email_events", t0)
        return r
      })(),
      (async () => {
        const t0 = performance.now()
        const r = await supabase
          .from("inbound_email_messages")
          .select("id, subject, received_at, processing_status")
          .eq("business_id", businessId)
          .order("received_at", { ascending: false })
          .limit(limit)
        devServiceActivityLog("query: inbound_email_messages", t0)
        return r
      })(),
    ])

    if (journalError) {
      console.error("[service-activity] journal_entries:", journalError.message)
      return finish(NextResponse.json({ error: journalError.message }, { status: 500 }))
    }
    if (resendError) {
      console.warn("[service-activity] resend_email_events:", resendError.message)
    }
    if (inboundError) {
      console.warn("[service-activity] inbound_email_messages:", inboundError.message)
    }

    const tJournalBuild = performance.now()
    const journalItems = await buildJournalActivityItems(supabase, (entries ?? []) as Record<string, unknown>[])
    devServiceActivityLog("buildJournalActivityItems", tJournalBuild)

    const resendItems: ActivityFeedItem[] = (resendRows ?? []).map((r) => ({
      id: `resend-email:${r.id as string}`,
      type: "email",
      description: resendOutboundDescription(String(r.event_type)),
      timestamp: (r.event_occurred_at as string | null) ?? (r.received_at as string),
    }))

    const inboundHref = `/service/incoming-documents?business_id=${encodeURIComponent(businessId)}`
    const inboundItems: ActivityFeedItem[] = (inboundRows ?? []).map((r) => ({
      id: `inbound-email:${r.id as string}`,
      type: "email",
      description: inboundDescription({
        subject: r.subject as string | null,
        processing_status: String(r.processing_status ?? ""),
      }),
      timestamp: r.received_at as string,
      href: inboundHref,
    }))

    const merged = [...journalItems, ...resendItems, ...inboundItems]
      .sort((a, b) => activityTimestampMs(b.timestamp) - activityTimestampMs(a.timestamp))
      .slice(0, limit)

    return finish(NextResponse.json({ items: merged }))
  } catch (err) {
    console.error("service-activity error:", err)
    return finish(NextResponse.json({ error: "Server error" }, { status: 500 }))
  }
}
