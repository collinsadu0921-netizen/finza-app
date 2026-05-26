/**
 * Authenticated: list Hubtel invoice sessions pending verification + retry verify.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { verifyTenantHubtelInvoiceByReference } from "@/lib/tenantPayments/hubtelInvoiceDirectService"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { data: rows, error } = await supabase
      .from("payment_provider_transactions")
      .select(
        `
        id,
        reference,
        status,
        amount_minor,
        currency,
        provider_transaction_id,
        payment_id,
        created_at,
        updated_at,
        last_event_at,
        last_event_payload,
        invoices ( id, invoice_number, customers ( name ) )
      `
      )
      .eq("business_id", scope.businessId)
      .eq("provider_type", "hubtel")
      .eq("workspace", "service")
      .in("status", ["pending_verification", "pending", "initiated"])
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const items = (rows ?? []).map((row) => {
      const inv = row.invoices as
        | { invoice_number?: string; customers?: { name?: string } | null }
        | null
        | undefined
      const last = (row.last_event_payload ?? {}) as Record<string, unknown>
      return {
        id: row.id,
        clientReference: row.reference,
        status: row.status,
        amount: typeof row.amount_minor === "number" ? row.amount_minor / 100 : null,
        currency: row.currency,
        checkoutId: row.provider_transaction_id,
        paymentId: row.payment_id,
        invoiceNumber: inv?.invoice_number ?? null,
        customerName: inv?.customers?.name ?? null,
        lastVerificationError:
          typeof last.verificationError === "string" ? last.verificationError : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastEventAt: row.last_event_at,
      }
    })

    return NextResponse.json({ items })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as { business_id?: string; clientReference?: string }
    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const clientReference = (body.clientReference ?? "").trim()
    if (!clientReference) {
      return NextResponse.json({ error: "clientReference is required" }, { status: 400 })
    }

    const { data: txn } = await supabase
      .from("payment_provider_transactions")
      .select("id, business_id")
      .eq("reference", clientReference)
      .eq("provider_type", "hubtel")
      .eq("business_id", scope.businessId)
      .maybeSingle()

    if (!txn) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const result = await verifyTenantHubtelInvoiceByReference(supabase, clientReference)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode })
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      applied: result.applied,
      message: result.message,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
