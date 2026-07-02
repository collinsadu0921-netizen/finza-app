import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import {
  buildCustomerApprovalPatch,
  CUSTOMER_APPROVAL_AUDIT_ACTIONS,
  parseCustomerApprovalAction,
} from "@/lib/invoices/customerApproval"

const APPROVAL_SELECT = `
  id,
  business_id,
  status,
  invoice_number,
  customer_approval_status,
  customer_approval_requested_at,
  customer_approved_at,
  customer_rejected_at,
  customer_approval_note,
  customer_approval_method,
  customer_approval_requested_by,
  customer_approval_updated_by
`

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const invoiceId = resolvedParams.id?.trim()
    if (!invoiceId) {
      return NextResponse.json({ error: "Invoice ID is required" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const action = parseCustomerApprovalAction(body)
    if (!action) {
      return NextResponse.json(
        { error: "Invalid approval action. Use action or status in the request body." },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: invoiceCheck, error: checkError } = await supabase
      .from("invoices")
      .select("id, business_id, deleted_at, status")
      .eq("id", invoiceId)
      .maybeSingle()

    if (checkError) {
      return NextResponse.json({ error: checkError.message }, { status: 500 })
    }
    if (!invoiceCheck || invoiceCheck.deleted_at) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const businessId = invoiceCheck.business_id
    const role = await getUserRole(supabase, user.id, businessId)
    if (!role) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const writeDenied = await enforceServiceIndustryFinancialWrite(
      supabase,
      user.id,
      businessId,
      "starter"
    )
    if (writeDenied) return writeDenied

    const { data: before, error: beforeError } = await supabase
      .from("invoices")
      .select(APPROVAL_SELECT)
      .eq("id", invoiceId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .single()

    if (beforeError || !before) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const patch = buildCustomerApprovalPatch(action, user.id, {
      note: typeof body.note === "string" ? body.note : null,
      method: typeof body.method === "string" ? body.method : null,
    })

    const { data: updated, error: updateError } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", invoiceId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .select(APPROVAL_SELECT)
      .single()

    if (updateError || !updated) {
      console.error("Invoice approval update failed:", updateError)
      return NextResponse.json(
        { error: updateError?.message || "Could not update invoice approval" },
        { status: 500 }
      )
    }

    await createAuditLog({
      businessId,
      userId: user.id,
      actionType: CUSTOMER_APPROVAL_AUDIT_ACTIONS[action],
      entityType: "invoice",
      entityId: invoiceId,
      oldValues: {
        status: before.status,
        customer_approval_status: before.customer_approval_status,
      },
      newValues: {
        status: updated.status,
        customer_approval_status: updated.customer_approval_status,
        customer_approval_note: updated.customer_approval_note,
      },
      request,
    })

    return NextResponse.json({
      success: true,
      invoice: updated,
      financialStatusUnchanged: before.status === updated.status,
    })
  } catch (error: unknown) {
    console.error("Invoice approval error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
