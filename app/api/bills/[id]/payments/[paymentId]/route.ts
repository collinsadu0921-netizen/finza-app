import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> | { id: string; paymentId: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id
    const paymentId = resolvedParams.paymentId

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { amount, date, method, reference, notes, business_id } = body

    if (!business_id) {
      return NextResponse.json({ error: "business_id is required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "professional",
    })
    if (denied) return denied

    // Verify payment exists
    const { data: existingPayment } = await supabase
      .from("bill_payments")
      .select("id, bill_id")
      .eq("id", paymentId)
      .eq("bill_id", billId)
      .eq("business_id", business_id)
      .single()

    if (!existingPayment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (amount !== undefined) updateData.amount = Number(amount)
    if (date !== undefined) updateData.date = date
    if (method !== undefined) updateData.method = method
    if (reference !== undefined) updateData.reference = reference?.trim() || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    const { data: payment, error } = await supabase
      .from("bill_payments")
      .update(updateData)
      .eq("id", paymentId)
      .select()
      .single()

    if (error) {
      console.error("Error updating payment:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ payment })
  } catch (error: any) {
    console.error("Error updating payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> | { id: string; paymentId: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id
    const paymentId = resolvedParams.paymentId

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const business_id = searchParams.get("business_id")

    if (!business_id) {
      return NextResponse.json(
        { error: "business_id is required" },
        { status: 400 }
      )
    }

    const desDenied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "professional",
    })
    if (desDenied) return desDenied

    // Get payment before deletion for audit log — scoped to this business
    const { data: existingPayment } = await supabase
      .from("bill_payments")
      .select("*")
      .eq("id", paymentId)
      .eq("business_id", business_id)
      .single()

    // Soft delete
    const { error } = await supabase
      .from("bill_payments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", paymentId)
      .eq("bill_id", billId)
      .eq("business_id", business_id)

    if (error) {
      console.error("Error deleting payment:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      await createAuditLog({
        businessId: business_id,
        userId: user?.id || null,
        actionType: "bill_payment.deleted",
        entityType: "bill_payment",
        entityId: paymentId,
        oldValues: existingPayment || null,
        newValues: null,
        request,
        description: `Bill payment ${paymentId} deleted`,
      })
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ message: "Payment deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting payment:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

