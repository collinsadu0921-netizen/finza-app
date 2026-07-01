/**
 * Service dashboard activity feed loader (journal RPC + batched enrichment).
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import { supabaseErrorDiag, timedStepMs, type createRouteDiag } from "@/lib/server/routeDiagnostics"

export type ActivityType = "invoice" | "expense" | "payment" | "customer" | "email"

export type ServiceDashboardActivityItem = {
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

export const MAX_ACTIVITY_LIMIT = 15

interface DocCurrency {
  currency_code: string | null
  total: number | null
}

type JournalActivityRow = {
  id: string
  created_at: string
  description: string | null
  source_type: string | null
  reference_type: string | null
  reference_id: string | null
  journal_amount: number | string | null
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type RouteDiag = ReturnType<typeof createRouteDiag>

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

function journalAmountFromRow(e: JournalActivityRow): number {
  if (e.journal_amount != null) {
    return Math.round(Number(e.journal_amount) * 100) / 100
  }
  return 0
}

function basicJournalActivityItems(entries: JournalActivityRow[]): ServiceDashboardActivityItem[] {
  return entries.map((e) => {
    const srcRaw = ((e.source_type ?? e.reference_type ?? "journal") as string).toLowerCase()
    const type: Exclude<ActivityType, "email"> = SOURCE_TYPE_MAP[srcRaw] ?? "expense"
    const rawDesc = e.description
    const description =
      rawDesc ||
      (e.reference_type
        ? `${e.reference_type.replace(/_/g, " ")} entry`
        : "Journal entry")
    return {
      id: e.id,
      type,
      description,
      amount: journalAmountFromRow(e),
      timestamp: e.created_at,
    }
  })
}

async function buildJournalActivityItems(
  supabase: SupabaseClient,
  entries: JournalActivityRow[]
): Promise<ServiceDashboardActivityItem[]> {
  const invoiceIds: string[] = []
  const billIds: string[] = []
  const expenseIds: string[] = []
  const paymentIds: string[] = []

  for (const e of entries) {
    const refId = e.reference_id
    const refType = e.reference_type?.toLowerCase()
    if (!refId) continue
    if (refType === "invoice") invoiceIds.push(refId)
    else if (refType === "bill") billIds.push(refId)
    else if (refType === "expense") expenseIds.push(refId)
    else if (refType === "payment" || refType === "receipt" || refType === "customer_payment")
      paymentIds.push(refId)
  }

  const [{ data: invDocs }, { data: billDocs }, { data: expDocs }, { data: paymentRows }] =
    await Promise.all([
      invoiceIds.length
        ? supabase.from("invoices").select("id, currency_code, total").in("id", invoiceIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
      billIds.length
        ? supabase.from("bills").select("id, currency_code, total").in("id", billIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
      expenseIds.length
        ? supabase.from("expenses").select("id, currency_code, total").in("id", expenseIds)
        : Promise.resolve({ data: [] as { id: string; currency_code: string | null; total: number | null }[] }),
      paymentIds.length
        ? supabase
            .from("payments")
            .select("id, invoice_id, amount")
            .in("id", paymentIds)
            .is("deleted_at", null)
        : Promise.resolve({
            data: [] as { id: string; invoice_id: string; amount: number | null }[],
          }),
    ])

  const docMap = new Map<string, DocCurrency>()
  for (const d of [...(invDocs ?? []), ...(billDocs ?? []), ...(expDocs ?? [])]) {
    docMap.set(d.id, { currency_code: d.currency_code, total: d.total })
  }

  const paymentInvoiceMap = new Map<string, { invoice_id: string; amount: number | null }>()
  for (const p of paymentRows ?? []) {
    paymentInvoiceMap.set(p.id, { invoice_id: p.invoice_id, amount: p.amount })
  }

  const paymentInvoiceIds = [...new Set([...paymentInvoiceMap.values()].map((p) => p.invoice_id))]
  const missingInvIds = paymentInvoiceIds.filter((id) => !docMap.has(id))
  if (missingInvIds.length > 0) {
    const { data: payInvDocs } = await supabase
      .from("invoices")
      .select("id, currency_code, total")
      .in("id", missingInvIds)
    for (const d of payInvDocs ?? []) {
      docMap.set(d.id, { currency_code: d.currency_code, total: d.total })
    }
  }

  return entries.map((e) => {
    const journalAmount = journalAmountFromRow(e)
    const srcRaw = ((e.source_type ?? e.reference_type ?? "journal") as string).toLowerCase()
    const type: Exclude<ActivityType, "email"> = SOURCE_TYPE_MAP[srcRaw] ?? "expense"

    const refId = e.reference_id
    const refType = e.reference_type?.toLowerCase()
    const paymentLink = refId ? paymentInvoiceMap.get(refId) : null
    const invoiceIdForPayment = paymentLink?.invoice_id
    const doc =
      refType === "invoice" && refId
        ? docMap.get(refId)
        : invoiceIdForPayment
          ? docMap.get(invoiceIdForPayment)
          : refId
            ? docMap.get(refId)
            : null
    const currencyCode: string | undefined = doc?.currency_code ?? undefined
    const paymentAmount =
      paymentLink?.amount != null ? Math.round(Number(paymentLink.amount) * 100) / 100 : null
    const amount =
      paymentAmount != null
        ? paymentAmount
        : doc?.total != null
          ? Math.round(doc.total * 100) / 100
          : journalAmount

    let href: string | undefined
    const srcType = (e.source_type ?? e.reference_type)?.toLowerCase()
    if (srcType === "invoice" && refId) href = `/service/invoices/${refId}`
    else if ((srcType === "bill" || srcType === "expense") && refId)
      href = `/service/expenses/${refId}`
    else if (
      (srcType === "payment" || srcType === "receipt" || srcType === "customer_payment") &&
      invoiceIdForPayment
    )
      href = `/service/invoices/${invoiceIdForPayment}`

    const rawDesc = e.description
    const description =
      rawDesc ||
      (e.reference_type
        ? `${e.reference_type.replace(/_/g, " ")} entry`
        : "Journal entry")

    return {
      id: e.id,
      type,
      description,
      amount,
      currencyCode,
      timestamp: e.created_at,
      href,
    }
  })
}

export async function loadServiceDashboardActivityFeed(
  supabase: SupabaseClient,
  businessId: string,
  limit: number,
  diag: RouteDiag
): Promise<{ items: ServiceDashboardActivityItem[] }> {
  const journalFetchLimit = Math.min(MAX_ACTIVITY_LIMIT, limit + 5)

  const [
    { data: entries, error: journalError },
    { data: resendRows, error: resendError },
    { data: inboundRows, error: inboundError },
  ] = await Promise.all([
    (async () => {
      const t0 = performance.now()
      const r = await supabase.rpc("get_service_dashboard_journal_activity", {
        p_business_id: businessId,
        p_limit: journalFetchLimit,
      })
      diag.step("journal_activity_rpc", {
        ms_query: timedStepMs(t0),
        row_count: (r.data ?? []).length,
        ...(r.error ? supabaseErrorDiag(r.error) : {}),
      })
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
      diag.step("resend_email_events_query", {
        ms_query: timedStepMs(t0),
        row_count: (r.data ?? []).length,
        ...(r.error ? supabaseErrorDiag(r.error) : {}),
      })
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
      diag.step("inbound_email_messages_query", {
        ms_query: timedStepMs(t0),
        row_count: (r.data ?? []).length,
        ...(r.error ? supabaseErrorDiag(r.error) : {}),
      })
      return r
    })(),
  ])

  if (journalError) {
    console.error("[service-activity] journal_activity_rpc:", journalError.message)
    diag.fail(500, "journal_query_failed", supabaseErrorDiag(journalError))
    throw journalError
  }
  if (resendError) {
    console.warn("[service-activity] resend_email_events:", resendError.message)
    diag.step("resend_feed_degraded", supabaseErrorDiag(resendError))
  }
  if (inboundError) {
    console.warn("[service-activity] inbound_email_messages:", inboundError.message)
    diag.step("inbound_feed_degraded", supabaseErrorDiag(inboundError))
  }

  const journalRows = (entries ?? []) as JournalActivityRow[]
  const tJournalBuild = performance.now()
  let journalItems: ServiceDashboardActivityItem[]
  try {
    journalItems = await buildJournalActivityItems(supabase, journalRows)
  } catch (enrichErr) {
    console.warn("[service-activity] enrichment failed:", enrichErr)
    diag.step("build_journal_items_degraded", {
      ms_build: timedStepMs(tJournalBuild),
      error: enrichErr instanceof Error ? enrichErr.message : "enrichment_failed",
    })
    journalItems = basicJournalActivityItems(journalRows)
  }
  diag.step("build_journal_items", {
    ms_build: timedStepMs(tJournalBuild),
    item_count: journalItems.length,
  })

  const resendItems: ServiceDashboardActivityItem[] = resendError
    ? []
    : (resendRows ?? []).map((r) => ({
        id: `resend-email:${r.id as string}`,
        type: "email" as const,
        description: resendOutboundDescription(String(r.event_type)),
        timestamp: (r.event_occurred_at as string | null) ?? (r.received_at as string),
      }))

  const inboundHref = `/service/incoming-documents?business_id=${encodeURIComponent(businessId)}`
  const inboundItems: ServiceDashboardActivityItem[] = inboundError
    ? []
    : (inboundRows ?? []).map((r) => ({
        id: `inbound-email:${r.id as string}`,
        type: "email" as const,
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

  diag.step("merge", {
    journal_rows: journalRows.length,
    item_count: merged.length,
    limit,
    resend_ok: !resendError,
    inbound_ok: !inboundError,
  })

  return { items: merged }
}
