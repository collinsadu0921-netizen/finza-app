import { NextRequest, NextResponse } from "next/server"

import { resolveBusinessScopeForUser } from "@/lib/business"
import { invoiceRowsToEvatDraftInput } from "@/lib/gra/evat/invoiceToEvatDraftInput"
import { mapInvoiceToEvatDraft } from "@/lib/gra/evat/mapInvoiceToEvatDraft"
import {
  createDraftEvatSubmission,
  toPublicGraEvatSubmissionRow,
  type GraEvatSubmissionType,
} from "@/lib/gra/evat/submissions"
import type { EvatEnvironment } from "@/lib/gra/evat/enrollment"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

const SUBMISSION_TYPES = new Set<GraEvatSubmissionType>([
  "invoice",
  "refund",
  "partial_refund",
  "cancellation",
  "credit_note",
  "debit_note",
])

function logSupabaseErrorDev(context: string, err: { message?: string; details?: string; hint?: string; code?: string }) {
  if (process.env.NODE_ENV !== "development") return
  console.error(`gra evat draft: ${context}`, {
    message: err.message,
    details: err.details,
    hint: err.hint,
    code: err.code,
  })
}

function safeSupabaseDebug(err: { message?: string; details?: string; hint?: string; code?: string }) {
  return {
    message: err.message ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
    code: err.code ?? null,
  }
}

function parseEvatEnvironment(v: unknown): EvatEnvironment | null {
  if (v === undefined || v === null) return "test"
  if (v === "test" || v === "live") return v
  return null
}

function parseSubmissionType(v: unknown): GraEvatSubmissionType | null {
  if (v === undefined || v === null) return "invoice"
  if (typeof v !== "string") return null
  if (SUBMISSION_TYPES.has(v as GraEvatSubmissionType)) return v as GraEvatSubmissionType
  return null
}

async function readJsonBody(request: NextRequest): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; message: string }
> {
  const ct = request.headers.get("content-type") ?? ""
  if (!ct.includes("application/json")) {
    return { ok: true, body: {} }
  }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, status: 400, message: "Could not read body" }
  }
  if (!text.trim()) return { ok: true, body: {} }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, message: "JSON body must be an object" }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON body" }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> | { invoiceId: string } }
) {
  try {
    const { invoiceId } = await Promise.resolve(params)
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: "Invoice ID is required" }, { status: 400 })
    }

    const parsedBody = await readJsonBody(request)
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.message }, { status: parsedBody.status })
    }
    const raw = parsedBody.body

    const environment = parseEvatEnvironment(raw.environment)
    if (!environment) {
      return NextResponse.json({ error: 'environment must be "test" or "live"' }, { status: 400 })
    }

    const submissionType = parseSubmissionType(raw.submission_type ?? raw.submissionType)
    if (!submissionType) {
      return NextResponse.json({ error: "Invalid submission_type" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const requestedBusinessId =
      new URL(request.url).searchParams.get("business_id") ||
      (typeof raw.business_id === "string" ? raw.business_id.trim() : "") ||
      null

    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId || null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const scopedBusinessId = scope.businessId

    // Note: do not select columns that may not exist on `invoices` in all DBs (e.g. legacy schemas).
    // Invoice detail GET uses `*` so missing optional columns do not break; this route lists columns explicitly.
    const invoiceSelect = `
      id,
      business_id,
      invoice_number,
      issue_date,
      created_at,
      currency_code,
      subtotal,
      total_tax,
      total,
      tax_lines,
      customers (
        id,
        name,
        email,
        phone,
        whatsapp_phone,
        address,
        tin
      ),
      businesses (
        id,
        name,
        tax_id,
        tin,
        address_country
      )
    `

    const [{ data: invoice, error: invoiceError }, { data: enrollment, error: enrollmentError }] =
      await Promise.all([
        supabase
          .from("invoices")
          .select(invoiceSelect)
          .eq("id", invoiceId)
          .eq("business_id", scopedBusinessId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("business_gra_evat_enrollments")
          .select("id, enrollment_status")
          .eq("business_id", scopedBusinessId)
          .eq("environment", environment)
          .maybeSingle(),
      ])

    if (invoiceError) {
      logSupabaseErrorDev("invoice load error", invoiceError)
      console.error("gra evat draft: invoice load error", invoiceError.message)
      return NextResponse.json(
        {
          error: "Failed to load invoice",
          ...(process.env.NODE_ENV === "development"
            ? { debug: safeSupabaseDebug(invoiceError) }
            : {}),
        },
        { status: 500 }
      )
    }

    if (enrollmentError) {
      logSupabaseErrorDev("enrollment load error", enrollmentError)
      console.error("gra evat draft: enrollment load error", enrollmentError.message)
      return NextResponse.json(
        {
          error: "Failed to load E-VAT enrollment",
          ...(process.env.NODE_ENV === "development"
            ? { debug: safeSupabaseDebug(enrollmentError) }
            : {}),
        },
        { status: 500 }
      )
    }

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    // Align with GET /api/invoices/[id]: no invoice_items.deleted_at filter (column absent on some DBs).
    // Avoid embedding products_services — fragile when PostgREST relationship hints differ.
    const { data: itemRows, error: itemsError } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      logSupabaseErrorDev("invoice items load error", itemsError)
      console.error("gra evat draft: invoice items load error", itemsError.message)
      return NextResponse.json(
        {
          error: "Failed to load invoice items",
          ...(process.env.NODE_ENV === "development"
            ? { debug: safeSupabaseDebug(itemsError) }
            : {}),
        },
        { status: 500 }
      )
    }

    const mapperInput = invoiceRowsToEvatDraftInput(invoice, itemRows ?? [], enrollment)
    const draft = mapInvoiceToEvatDraft(mapperInput)

    if (!draft.submittable) {
      return NextResponse.json({
        ok: false,
        draft,
        blockingIssues: draft.blockingIssues,
        warnings: draft.warnings,
      })
    }

    const admin = createSupabaseAdminClient()
    const { data: submission, error: subErr } = await createDraftEvatSubmission(admin, {
      businessId: scopedBusinessId,
      invoiceId,
      enrollmentId: enrollment?.id ?? null,
      environment,
      submissionType,
      draft,
      createdBy: user.id,
    })

    if (subErr || !submission) {
      console.error("gra evat draft: submission insert error", subErr)
      return NextResponse.json(
        { error: subErr?.message || "Could not create draft submission" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      draft,
      submission: toPublicGraEvatSubmissionRow(submission),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal server error"
    console.error("gra evat draft route error", e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
