import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const proformaId = resolvedParams.id

    if (!proformaId) {
      return NextResponse.json(
        { error: "Proforma invoice ID is required" },
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

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Fetch proforma and verify ownership
    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .select("*")
      .eq("id", proformaId)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (proformaError || !proforma) {
      return NextResponse.json(
        { error: "Proforma invoice not found" },
        { status: 404 }
      )
    }

    if (proforma.status !== "sent") {
      return NextResponse.json(
        { error: "Only sent proformas can be accepted" },
        { status: 400 }
      )
    }

    const { data: updatedProforma, error: updateError } = await supabase
      .from("proforma_invoices")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", proformaId)
      .select()
      .single()

    if (updateError || !updatedProforma) {
      console.error("Error accepting proforma invoice:", updateError)
      return NextResponse.json(
        {
          success: false,
          error: "Proforma invoice could not be accepted. Please try again.",
          message: updateError?.message,
        },
        { status: 500 }
      )
    }

    // Log audit entry
    await createAuditLog({
      businessId: business.id,
      userId: user?.id || null,
      actionType: "proforma.accepted",
      entityType: "proforma_invoice",
      entityId: proformaId,
      oldValues: proforma,
      newValues: updatedProforma,
      request,
    })

    return NextResponse.json({
      success: true,
      proforma: updatedProforma,
    })
  } catch (error: any) {
    console.error("Error accepting proforma invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Proforma invoice could not be accepted. Please check your connection and try again.",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
