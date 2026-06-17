/**
 * Authenticated: list Hubtel invoice sessions pending verification + retry verify.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import {
  listHubtelInvoiceSessionsNeedingRetry,
  retryPendingHubtelInvoiceVerifications,
  verifyTenantHubtelInvoiceByReference,
} from "@/lib/tenantPayments/hubtelInvoiceDirectService"
import { hubtelStatusProxyConfigured } from "@/lib/tenantPayments/hubtelClient"

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

    const rows = await listHubtelInvoiceSessionsNeedingRetry(supabase, scope.businessId, 50)

    const items = rows.map((row) => {
      const inv = row.invoices as
        | { invoice_number?: string; customers?: { name?: string } | null }
        | null
        | undefined
      const last = row.last_event_payload ?? {}
      return {
        id: row.id,
        clientReference: row.reference,
        status: row.status,
        recoverableAmountMismatch: row.recoverableAmountMismatch,
        amount: typeof row.amount_minor === "number" ? row.amount_minor / 100 : null,
        currency: row.currency,
        checkoutId: row.provider_transaction_id,
        paymentId: row.payment_id,
        invoiceNumber: inv?.invoice_number ?? null,
        customerName: inv?.customers?.name ?? null,
        lastVerificationError:
          typeof last.verificationError === "string"
            ? last.verificationError
            : typeof last.accountingBootstrapError === "string"
              ? last.accountingBootstrapError
              : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastEventAt: row.last_event_at,
      }
    })

    return NextResponse.json({ items, statusProxyConfigured: hubtelStatusProxyConfigured() })
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

    const body = (await request.json()) as {
      business_id?: string
      clientReference?: string
      retryAll?: boolean
    }
    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.business_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const clientReference = (body.clientReference ?? "").trim()
    const retryAll = body.retryAll === true

    if (!clientReference && !retryAll) {
      return NextResponse.json(
        { error: "clientReference is required, or set retryAll: true to retry all pending sessions" },
        { status: 400 }
      )
    }

    if (retryAll) {
      const results = await retryPendingHubtelInvoiceVerifications(supabase, scope.businessId)
      return NextResponse.json({
        success: true,
        statusProxyConfigured: hubtelStatusProxyConfigured(),
        retried: results.length,
        results,
      })
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
      statusProxyConfigured: hubtelStatusProxyConfigured(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
