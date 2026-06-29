/**
 * GET  /api/cit?business_id=xxx          — list CIT provisions
 * POST /api/cit                          — create a new CIT provision (draft)
 * POST /api/cit?action=post              — post provision to ledger
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createAuditLog } from "@/lib/auditLog"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import {
  buildGhanaCitPeriod,
  calculateGhanaCitAmount,
  isGhanaCitProvisionType,
  resolveGhanaCitRate,
} from "@/lib/tax/ghanaCit"

const NO_CIT_PAYABLE_MESSAGE = "No CIT payable for this period; no journal entry is required."

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
        .select("business_id, cit_amount")
        .eq("id", provision_id)
        .maybeSingle()

      if (!provRow?.business_id) {
        return NextResponse.json({ error: "Provision not found" }, { status: 404 })
      }
      if (provRow.cit_amount == null || Number(provRow.cit_amount) <= 0) {
        return NextResponse.json({ error: NO_CIT_PAYABLE_MESSAGE }, { status: 400 })
      }

      const deniedPost = await enforceServiceWorkspaceWriteAccess({
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
        .select("business_id, cit_amount")
        .eq("id", provision_id)
        .maybeSingle()

      if (!provPay?.business_id || provPay.business_id !== payBusinessId) {
        return NextResponse.json(
          { error: "Provision not found or does not belong to this business" },
          { status: 400 }
        )
      }
      if (provPay.cit_amount == null || Number(provPay.cit_amount) <= 0) {
        return NextResponse.json({ error: NO_CIT_PAYABLE_MESSAGE }, { status: 400 })
      }

      const deniedPay = await enforceServiceWorkspaceWriteAccess({
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
      chargeable_income,
      gross_revenue = 0,   // used for Alternative Minimum Tax (AMT) calculation
      profit_before_tax,
      notes,
      auto_post = false,
    } = body
    const provision_type = isGhanaCitProvisionType(body.provision_type) ? body.provision_type : "quarterly"

    if (!business_id || !period_label || chargeable_income == null) {
      return NextResponse.json({ error: "business_id, period_label, and chargeable_income required" }, { status: 400 })
    }
    if (body.provision_type !== undefined && !isGhanaCitProvisionType(body.provision_type)) {
      return NextResponse.json({ error: "Invalid provision_type" }, { status: 400 })
    }

    const deniedCreate = await enforceServiceWorkspaceWriteAccess({
      supabase,
      userId: user?.id,
      businessId: business_id,
      minTier: "business",
    })
    if (deniedCreate) return deniedCreate

    const { data: businessRow, error: businessError } = await supabase
      .from("businesses")
      .select("cit_rate_code")
      .eq("id", business_id)
      .maybeSingle()

    if (businessError) return NextResponse.json({ error: businessError.message }, { status: 500 })
    if (!businessRow) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const rateInfo = resolveGhanaCitRate((businessRow as { cit_rate_code?: unknown }).cit_rate_code)
    const period = buildGhanaCitPeriod({
      provisionType: provision_type,
      periodLabel: period_label,
    })

    const { data: existingProvision, error: existingError } = await supabase
      .from("cit_provisions")
      .select("*")
      .eq("business_id", business_id)
      .eq("provision_type", provision_type)
      .eq("period_start", period.periodStart)
      .eq("period_end", period.periodEnd)
      .maybeSingle()

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
    if (existingProvision) {
      return NextResponse.json(
        {
          error: `A CIT provision already exists for ${period.periodLabel}.`,
          provision: existingProvision,
        },
        { status: 409 }
      )
    }

    const chargeableIncomeNumber = Number(chargeable_income)
    const grossRevenueNumber = Number(gross_revenue || 0)
    const { standardCit, minimumTaxAmount: amtAmount, minimumTaxApplies: amtApplies, citAmount } =
      calculateGhanaCitAmount({
        chargeableIncome: chargeableIncomeNumber,
        grossRevenue: grossRevenueNumber,
        rate: rateInfo,
      })
    const profitBeforeTaxSnapshot =
      profit_before_tax != null
        ? Number(profit_before_tax)
        : rateInfo.basis === "profit"
          ? chargeableIncomeNumber
          : null

    // Append AMT note when minimum tax overrides standard CIT
    let finalNotes = notes || null
    if (amtApplies) {
      const amtNote = `AMT applied: ${citAmount.toFixed(2)} (0.5% × ${grossRevenueNumber.toFixed(2)} gross revenue) > Standard CIT: ${standardCit.toFixed(2)}`
      finalNotes = finalNotes ? `${finalNotes}\n${amtNote}` : amtNote
    }

    const { data: provision, error: provErr } = await supabase
      .from("cit_provisions")
      .insert({
        business_id,
        period_label: period.periodLabel,
        provision_type,
        chargeable_income: chargeableIncomeNumber,
        cit_rate: rateInfo.rate,
        cit_amount: citAmount,
        fiscal_year: period.fiscalYear,
        quarter: period.quarter,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        due_date: period.dueDate,
        profit_before_tax: profitBeforeTaxSnapshot,
        gross_revenue: grossRevenueNumber,
        add_backs_total: 0,
        deductions_total: 0,
        status: "draft",
        notes: finalNotes,
        created_by: user!.id,
      })
      .select()
      .single()

    if (provErr) {
      if (provErr.code === "23505") {
        const { data: duplicateProvision } = await supabase
          .from("cit_provisions")
          .select("*")
          .eq("business_id", business_id)
          .eq("provision_type", provision_type)
          .eq("period_start", period.periodStart)
          .eq("period_end", period.periodEnd)
          .maybeSingle()
        if (duplicateProvision) {
          return NextResponse.json(
            {
              error: `A CIT provision already exists for ${period.periodLabel}.`,
              provision: duplicateProvision,
            },
            { status: 409 }
          )
        }
      }
      return NextResponse.json({ error: provErr.message }, { status: 500 })
    }

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
      newValues: {
        period_label: period.periodLabel,
        provision_type,
        chargeable_income: chargeableIncomeNumber,
        gross_revenue: grossRevenueNumber,
        profit_before_tax: profitBeforeTaxSnapshot,
        cit_rate_code: rateInfo.code,
        cit_rate: rateInfo.rate,
        cit_amount: citAmount,
        amt_applied: amtApplies,
        amt_amount: amtAmount,
        fiscal_year: period.fiscalYear,
        quarter: period.quarter,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        due_date: period.dueDate,
      },
      request,
    })

    return NextResponse.json({ success: true, provision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
