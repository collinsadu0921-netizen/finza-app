/**
 * GET  /api/cit?business_id=xxx          — list CIT provisions
 * POST /api/cit                          — create a new CIT provision (draft)
 * POST /api/cit?action=post              — post provision to ledger
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

const GH_CIT_RATE = 0.25  // 25% standard Ghana CIT rate

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

    if (!businessId) {
      return NextResponse.json({ error: "business_id required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId,
      minTier: "business",
    })
    if (denied) return denied

    const { data: provisions, error } = await supabase
      .from("cit_provisions")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ provisions: provisions ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { searchParams } = new URL(request.url)
    const action = searchParams.get("action")

    const body = await request.json()

    // POST with action=post → post existing provision to ledger
    if (action === "post") {
      const { provision_id } = body
      if (!provision_id) return NextResponse.json({ error: "provision_id required" }, { status: 400 })

      const { data: provRow } = await supabase
        .from("cit_provisions")
        .select("business_id")
        .eq("id", provision_id)
        .maybeSingle()

      if (!provRow?.business_id) {
        return NextResponse.json({ error: "Provision not found" }, { status: 404 })
      }

      const deniedPost = await enforceServiceWorkspaceAccess({
        supabase,
        userId: user?.id,
        businessId: provRow.business_id,
        minTier: "business",
      })
      if (deniedPost) return deniedPost

      const { data: jeId, error: ledgerErr } = await supabase
        .rpc("post_cit_provision_to_ledger", { p_provision_id: provision_id })

      if (ledgerErr) {
        console.error("CIT ledger error:", ledgerErr)
        return NextResponse.json({ error: ledgerErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, journal_entry_id: jeId })
    }

    // POST with action=pay → mark provision as paid, post payment journal
    if (action === "pay") {
      const { provision_id, business_id: payBusinessId, payment_account_code = "1010", payment_date, payment_ref } = body
      if (!provision_id) return NextResponse.json({ error: "provision_id required" }, { status: 400 })
      if (!payBusinessId) {
        return NextResponse.json({ error: "business_id required" }, { status: 400 })
      }

      const { data: provPay } = await supabase
        .from("cit_provisions")
        .select("business_id")
        .eq("id", provision_id)
        .maybeSingle()

      if (!provPay?.business_id || provPay.business_id !== payBusinessId) {
        return NextResponse.json(
          { error: "Provision not found or does not belong to this business" },
          { status: 400 }
        )
      }

      const deniedPay = await enforceServiceWorkspaceAccess({
        supabase,
        userId: user?.id,
        businessId: payBusinessId,
        minTier: "business",
      })
      if (deniedPay) return deniedPay

      const { data: jeId, error: payErr } = await supabase.rpc(
        "post_cit_payment_to_ledger",
        {
          p_provision_id:         provision_id,
          p_payment_account_code: payment_account_code,
          p_payment_date:         payment_date || new Date().toISOString().split("T")[0],
          p_payment_ref:          payment_ref || null,
        }
      )

      if (payErr) {
        console.error("CIT payment ledger error:", payErr)
        return NextResponse.json({ error: payErr.message }, { status: 500 })
      }

      await createAuditLog({
        businessId: payBusinessId,
        userId: user?.id || null,
        actionType: "cit.payment_posted",
        entityType: "cit_provision",
        entityId: provision_id,
        oldValues: null,
        newValues: { payment_account_code, payment_date, payment_ref },
        request,
      })

      return NextResponse.json({ success: true, journal_entry_id: jeId })
    }

    // POST → create new provision
    const {
      business_id,
      period_label,
      provision_type = "quarterly",
      chargeable_income,
      cit_rate = GH_CIT_RATE,
      gross_revenue = 0,   // used for Alternative Minimum Tax (AMT) calculation
      notes,
      auto_post = false,
    } = body

    if (!business_id || !period_label || chargeable_income == null) {
      return NextResponse.json({ error: "business_id, period_label, and chargeable_income required" }, { status: 400 })
    }

    const deniedCreate = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user?.id,
      businessId: business_id,
      minTier: "business",
    })
    if (deniedCreate) return deniedCreate

    // Ghana AMT: 0.5% of gross revenue — applies when standard CIT would be lower.
    // Exempt (rate=0) and presumptive (rate=0.03 turnover-based) are not subject to AMT.
    const isExemptOrPresumptive = cit_rate === 0 || cit_rate === 0.03
    const standardCit = Math.round(Math.max(0, chargeable_income) * cit_rate * 100) / 100
    const amtAmount   = (!isExemptOrPresumptive && gross_revenue > 0)
      ? Math.round(gross_revenue * 0.005 * 100) / 100
      : 0
    const amtApplies  = amtAmount > standardCit
    const citAmount   = Math.max(standardCit, amtAmount)

    // Append AMT note when minimum tax overrides standard CIT
    let finalNotes = notes || null
    if (amtApplies) {
      const amtNote = `AMT applied: ${citAmount.toFixed(2)} (0.5% × ${gross_revenue.toFixed(2)} gross revenue) > Standard CIT: ${standardCit.toFixed(2)}`
      finalNotes = finalNotes ? `${finalNotes}\n${amtNote}` : amtNote
    }

    const { data: provision, error: provErr } = await supabase
      .from("cit_provisions")
      .insert({
        business_id,
        period_label,
        provision_type,
        chargeable_income,
        cit_rate,
        cit_amount: citAmount,
        status: "draft",
        notes: finalNotes,
        created_by: user!.id,
      })
      .select()
      .single()

    if (provErr) return NextResponse.json({ error: provErr.message }, { status: 500 })

    // Auto-post to ledger if requested
    if (auto_post && citAmount > 0) {
      const { error: autoPostErr } = await supabase.rpc(
        "post_cit_provision_to_ledger",
        { p_provision_id: provision.id }
      )
      if (autoPostErr) {
        console.error("CIT auto_post failed:", autoPostErr)
        // Provision was created as draft; return it with a warning so the
        // client can surface the failure rather than silently leaving it in draft.
        return NextResponse.json({
          success: true,
          provision,
          warning: `Provision created but auto-post failed: ${autoPostErr.message}`,
        })
      }
    }

    await createAuditLog({
      businessId: business_id,
      userId: user!.id,
      actionType: "cit.provision_created",
      entityType: "cit_provision",
      entityId: provision.id,
      oldValues: null,
      newValues: { period_label, chargeable_income, gross_revenue, cit_amount: citAmount, amt_applied: amtApplies },
      request,
    })

    return NextResponse.json({ success: true, provision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
