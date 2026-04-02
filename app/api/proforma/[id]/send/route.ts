import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
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

    const body = await request.json().catch(() => ({}))
    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    // Fetch proforma and verify it belongs to resolved workspace
    const { data: proforma, error: proformaError } = await supabase
      .from("proforma_invoices")
      .select("*")
      .eq("id", proformaId)
      .eq("business_id", scope.businessId)
      .is("deleted_at", null)
      .single()

    if (proformaError || !proforma) {
      return NextResponse.json(
        { error: "Proforma invoice not found" },
        { status: 404 }
      )
    }

    if (proforma.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft proformas can be sent" },
        { status: 400 }
      )
    }

    // Generate proforma number if not already assigned
    let proformaNumber = proforma.proforma_number
    if (!proformaNumber) {
      const { data: proformaNumData } = await supabase.rpc("generate_proforma_number", {
        p_business_id: scope.businessId,
      })
      proformaNumber = proformaNumData || null
      if (!proformaNumber) {
        return NextResponse.json(
          {
            success: false,
            error: "Failed to generate proforma number. Please try again.",
          },
          { status: 500 }
        )
      }
    }

    const { data: updatedProforma, error: updateError } = await supabase
      .from("proforma_invoices")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        proforma_number: proformaNumber,
      })
      .eq("id", proformaId)
      .select()
      .single()

    if (updateError || !updatedProforma) {
      console.error("Error sending proforma invoice:", updateError)
      return NextResponse.json(
        {
          success: false,
          error: "Proforma invoice could not be sent. Please try again.",
          message: updateError?.message,
        },
        { status: 500 }
      )
    }

    let finalProforma = updatedProforma
    if (!finalProforma.public_token) {
      const { data: tokenData, error: tokErr } = await supabase.rpc("generate_public_token")
      if (tokErr || tokenData == null) {
        return NextResponse.json(
          { success: false, error: "Failed to generate client link for this proforma." },
          { status: 500 }
        )
      }
      const publicToken = String(tokenData)
      const { data: withTok, error: tokUpdateErr } = await supabase
        .from("proforma_invoices")
        .update({ public_token: publicToken })
        .eq("id", proformaId)
        .select()
        .single()
      if (tokUpdateErr || !withTok) {
        return NextResponse.json(
          { success: false, error: "Failed to save client link for this proforma." },
          { status: 500 }
        )
      }
      finalProforma = withTok
    }

    // Log audit entry
    await createAuditLog({
      businessId: scope.businessId,
      userId: user?.id || null,
      actionType: "proforma.sent",
      entityType: "proforma_invoice",
      entityId: proformaId,
      oldValues: proforma,
      newValues: finalProforma,
      request,
    })

    return NextResponse.json({
      success: true,
      proforma: finalProforma,
    })
  } catch (error: any) {
    console.error("Error sending proforma invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Proforma invoice could not be sent. Please check your connection and try again.",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
