import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { calculateWHTForRate } from "@/lib/wht"
import { ghanaTaxEngineCanonical } from "@/lib/taxEngine/jurisdictions/ghana"
import { deriveLegacyTaxColumnsFromTaxLines } from "@/lib/taxEngine/helpers"
import { toBillTaxLinesJsonb, emptyBillTaxResult } from "@/lib/bills/billTaxLines"
import { resolveWhtRateForDate, WhtRateResolutionError } from "@/lib/wht/rateResolver"
import { createAuditLog } from "@/lib/auditLog"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"
import {
  enforceServiceWorkspaceAccess,
  enforceServiceWorkspaceWriteAccess,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveMaterialInventoryAccount } from "@/lib/bills/resolveMaterialInventoryAccount"
import { resolveBillSupplierLink } from "@/lib/bills/resolveBillSupplierLink"

type HeaderDiscountRejection = {
  error: string
  code: "unsupported_bill_level_discount"
}

/** Fail closed: omitted/null OK; zero OK; any non-zero or malformed header discount → reject. */
function rejectUnsupportedBillLevelDiscount(
  values: unknown[]
): HeaderDiscountRejection | null {
  const error =
    "unsupported_bill_level_discount: bill-level discounts are not supported; use line-level discount_amount on items"
  const code = "unsupported_bill_level_discount" as const

  for (const value of values) {
    if (value === undefined || value === null) continue

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value !== 0) {
        return { error, code }
      }
      continue
    }

    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed === "") {
        return { error, code }
      }
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
        return { error, code }
      }
      const n = Number(trimmed)
      if (!Number.isFinite(n) || n !== 0) {
        return { error, code }
      }
      continue
    }

    return { error, code }
  }

  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: bill, error } = await supabase
      .from("bills")
      .select("*, business_id")
      .eq("id", billId)
      .is("deleted_at", null)
      .maybeSingle()

    if (error || !bill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

    const billBusinessId = String(bill.business_id)

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: billBusinessId, minTier: "professional",
    })
    if (denied) return denied

    // Get bill items
    const { data: items, error: itemsError } = await supabase
      .from("bill_items")
      .select("*")
      .eq("bill_id", billId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      console.error("Error fetching bill items:", itemsError)
    }

    // Get bill payments
    const { data: payments, error: paymentsError } = await supabase
      .from("bill_payments")
      .select("*")
      .eq("bill_id", billId)
      .is("deleted_at", null)
      .order("date", { ascending: false })

    if (paymentsError) {
      console.error("Error fetching bill payments:", paymentsError)
    }

    const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
    const balance = billSupplierBalanceRemaining(
      Number(bill.total),
      bill.wht_applicable,
      bill.wht_amount,
      totalPaid
    )

    return NextResponse.json({
      bill,
      items: items || [],
      payments: payments || [],
      total_paid: totalPaid,
      balance,
    })
  } catch (error: any) {
    console.error("Error fetching bill:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: existingBill, error: billLookupError } = await supabase
      .from("bills")
      .select("id, status, total, subtotal, total_tax, issue_date, material_id, bill_type, cif_value, import_duty_rate, import_duty_amount, ecowas_levy, au_levy, exim_levy, sil_levy, examination_fee, clearing_agent_fee, landed_cost_account_code, wht_applicable, wht_rate_code, wht_rate, wht_amount, currency_code, fx_rate, business_id")
      .eq("id", billId)
      .is("deleted_at", null)
      .maybeSingle()

    if (billLookupError || !existingBill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

    const billBusinessId = String(existingBill.business_id)

    const denied = await enforceServiceWorkspaceWriteAccess({
      supabase, userId: user.id, businessId: billBusinessId, minTier: "professional",
    })
    if (denied) return denied

    const body = await request.json()
    const {
      supplier_id,
      supplier_name,
      supplier_phone,
      supplier_email,
      bill_number,
      issue_date,
      due_date,
      notes,
      items,
      apply_taxes,
      apply_wht,
      wht_rate_code,
      status,
      attachment_path,
      // Import bill fields
      bill_type,
      import_description,
      cif_value,
      import_duty_rate,
      import_duty_amount,
      ecowas_levy,
      au_levy,
      exim_levy,
      sil_levy,
      examination_fee,
      clearing_agent_fee,
      landed_cost_account_code,
      currency_code: body_currency_code,
      fx_rate: body_fx_rate,
      material_id: body_material_id,
      quantity: body_import_quantity,
      discount_amount: header_discount_amount,
      bill_discount_amount,
    } = body

    const headerDiscountRejection = rejectUnsupportedBillLevelDiscount([
      header_discount_amount,
      bill_discount_amount,
    ])
    if (headerDiscountRejection) {
      return NextResponse.json(
        {
          error: headerDiscountRejection.error,
          code: headerDiscountRejection.code,
        },
        { status: 400 }
      )
    }

    if (existingBill.status !== "draft" && items !== undefined) {
      return NextResponse.json(
        {
          error:
            "Posted bill lines cannot be edited or replaced. Draft bills may still be edited.",
          code: "posted_bill_lines_locked",
        },
        { status: 409 }
      )
    }

    // Build update data
    let updateData: any = {
      updated_at: new Date().toISOString(),
    }

    const effectiveBillType =
      bill_type !== undefined ? bill_type : existingBill.bill_type ?? "standard"
    const isImportBill = effectiveBillType === "import"
    const effectiveIssueDate =
      issue_date !== undefined ? issue_date : existingBill.issue_date
    const effectiveImportMaterialId =
      body_material_id !== undefined ? body_material_id : existingBill.material_id

    let existingTaxItems: any[] | null = null
    if (
      existingBill.status === "draft" &&
      issue_date !== undefined &&
      (!items || items.length === 0) &&
      !isImportBill
    ) {
      const { data: existingBillItems } = await supabase
        .from("bill_items")
        .select(
          "description, qty, unit_price, discount_amount, line_subtotal, account_id, material_id"
        )
        .eq("bill_id", billId)
        .order("created_at", { ascending: true })
      existingTaxItems = (existingBillItems ?? []).map((item: any) => ({
        description: item.description,
        qty: item.qty,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        account_id: item.account_id,
        material_id: item.material_id,
      }))
    }

    const taxItems = items ?? existingTaxItems
    const hasMaterialLines =
      (taxItems ?? []).some(
        (item: any) =>
          item.material_id != null && String(item.material_id).trim() !== ""
      ) ||
      (isImportBill &&
        effectiveImportMaterialId != null &&
        String(effectiveImportMaterialId).trim() !== "")
    const absorptionAccountCode = hasMaterialLines ? "1450" : "5200"

    const updateApplyTaxes =
      apply_taxes !== undefined
        ? apply_taxes
        : Number(existingBill.total_tax || 0) > 0
    const taxMaterialLines = (taxItems ?? []).filter(
      (item: any) =>
        item.material_id != null && String(item.material_id).trim() !== ""
    ).length
    const taxServiceLines = (taxItems ?? []).length - taxMaterialLines
    if (
      !isImportBill &&
      updateApplyTaxes &&
      effectiveIssueDate < "2026-01-01" &&
      taxMaterialLines > 0 &&
      taxServiceLines > 0
    ) {
      return NextResponse.json(
        {
          error:
            "Pre-2026 bills that mix inventory materials and services cannot allocate non-creditable NHIL/GETFund/COVID accurately. Split the bill into material and service bills.",
          code: "BILL_MIXED_MATERIAL_TAX_UNSUPPORTED",
        },
        { status: 400 }
      )
    }

    const importTaxInputsChanged =
      cif_value !== undefined ||
      import_duty_rate !== undefined ||
      import_duty_amount !== undefined ||
      ecowas_levy !== undefined ||
      au_levy !== undefined ||
      exim_levy !== undefined ||
      sil_levy !== undefined ||
      examination_fee !== undefined ||
      clearing_agent_fee !== undefined ||
      landed_cost_account_code !== undefined

    if (
      isImportBill &&
      (issue_date !== undefined || importTaxInputsChanged || items !== undefined)
    ) {
      // ── Import bill: forward-calculate taxes on the VAT base ──────────────
      const cifNum      = Number(cif_value !== undefined ? cif_value : existingBill.cif_value) || 0
      const dutyAmt     = Number(import_duty_amount !== undefined ? import_duty_amount : existingBill.import_duty_amount) || 0
      const ecowasAmt   = Number(ecowas_levy !== undefined ? ecowas_levy : existingBill.ecowas_levy) || 0
      const auAmt       = Number(au_levy !== undefined ? au_levy : existingBill.au_levy) || 0
      const eximAmt     = Number(exim_levy !== undefined ? exim_levy : existingBill.exim_levy) || 0
      const silAmt      = Number(sil_levy !== undefined ? sil_levy : existingBill.sil_levy) || 0
      const examAmt     = Number(examination_fee !== undefined ? examination_fee : existingBill.examination_fee) || 0
      const clearingAmt = Number(clearing_agent_fee !== undefined ? clearing_agent_fee : existingBill.clearing_agent_fee) || 0
      const vatBase     = Math.round((cifNum + dutyAmt + ecowasAmt + auAmt + eximAmt + silAmt + examAmt) * 100) / 100

      const applyGhanaTax =
        apply_taxes !== undefined
          ? apply_taxes
          : Number(existingBill.total_tax || 0) > 0
      let nhil = 0, getfund = 0, covid = 0, vat = 0, totalTax = 0
      let billTaxLines: Record<string, unknown>

      if (applyGhanaTax) {
        const canonical = ghanaTaxEngineCanonical.calculateFromAmount(vatBase, {
          jurisdiction: "GH",
          effectiveDate: effectiveIssueDate,
          taxInclusive: false,
          transactionType: "purchase",
        })
        const legacy = deriveLegacyTaxColumnsFromTaxLines(canonical.lines)
        nhil = legacy.nhil
        getfund = legacy.getfund
        covid = legacy.covid
        vat = legacy.vat
        totalTax = canonical.total_tax
        billTaxLines = toBillTaxLinesJsonb(canonical, absorptionAccountCode)
      } else {
        const canonical = emptyBillTaxResult({
          baseAmount: vatBase,
          effectiveDate: effectiveIssueDate,
          pricingMode: "exclusive",
        })
        billTaxLines = toBillTaxLinesJsonb(canonical, absorptionAccountCode)
      }

      const grandTotal = vatBase + totalTax + clearingAmt

      updateData.bill_type                = "import"
      updateData.import_description       = import_description ?? null
      updateData.cif_value                = cifNum
      updateData.import_duty_rate         = Number(import_duty_rate) || 0
      updateData.import_duty_amount       = dutyAmt
      updateData.ecowas_levy              = ecowasAmt
      updateData.au_levy                  = auAmt
      updateData.exim_levy                = eximAmt
      updateData.sil_levy                 = silAmt
      updateData.examination_fee          = examAmt
      updateData.clearing_agent_fee       = clearingAmt
      updateData.landed_cost_account_code = landed_cost_account_code ?? null
      updateData.subtotal                 = vatBase
      updateData.nhil                     = nhil
      updateData.getfund                  = getfund
      updateData.covid                    = covid
      updateData.vat                      = vat
      updateData.total_tax                = totalTax
      updateData.total                    = grandTotal
      updateData.tax_lines                = billTaxLines
      updateData.tax_engine_code          = "ghana"
      updateData.tax_engine_effective_from = effectiveIssueDate
      updateData.tax_jurisdiction         = "GH"

    } else if (!isImportBill && taxItems && taxItems.length > 0) {
      // ── Standard bill: reverse-calculate taxes from tax-inclusive total ───
      updateData.bill_type = "standard"

      const subtotalIncludingTaxes = taxItems.reduce((sum: number, item: any) => {
        const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
        const discount = Number(item.discount_amount) || 0
        return sum + lineTotal - discount
      }, 0)

      let taxResult: {
        subtotalBeforeTax: number
        nhil: number
        getfund: number
        covid: number
        vat: number
        totalTax: number
        grandTotal: number
      }
      let billTaxLines: Record<string, unknown>

      if (apply_taxes !== undefined ? apply_taxes : true) {
        const canonical = ghanaTaxEngineCanonical.reverseCalculate(
          subtotalIncludingTaxes,
          {
            jurisdiction: "GH",
            effectiveDate: effectiveIssueDate,
            taxInclusive: true,
            transactionType: "purchase",
          }
        )
        const legacy = deriveLegacyTaxColumnsFromTaxLines(canonical.lines)
        taxResult = {
          subtotalBeforeTax: canonical.base_amount,
          ...legacy,
          totalTax: canonical.total_tax,
          grandTotal: subtotalIncludingTaxes,
        }
        billTaxLines = toBillTaxLinesJsonb(canonical, absorptionAccountCode)
      } else {
        const canonical = emptyBillTaxResult({
          baseAmount: subtotalIncludingTaxes,
          effectiveDate: effectiveIssueDate,
          pricingMode: "inclusive",
        })
        taxResult = {
          subtotalBeforeTax: subtotalIncludingTaxes,
          nhil: 0,
          getfund: 0,
          covid: 0,
          vat: 0,
          totalTax: 0,
          grandTotal: subtotalIncludingTaxes,
        }
        billTaxLines = toBillTaxLinesJsonb(canonical, absorptionAccountCode)
      }

      updateData.subtotal   = taxResult.subtotalBeforeTax
      updateData.nhil       = taxResult.nhil
      updateData.getfund    = taxResult.getfund
      updateData.covid      = taxResult.covid
      updateData.vat        = taxResult.vat
      updateData.total_tax  = taxResult.totalTax
      updateData.total      = taxResult.grandTotal
      updateData.tax_lines  = billTaxLines
      updateData.tax_engine_code = "ghana"
      updateData.tax_engine_effective_from = effectiveIssueDate
      updateData.tax_jurisdiction = "GH"
      if (items !== undefined) {
        updateData.material_id = null
        updateData.quantity = null
      }
    }

    // Draft bills may be edited after their WHT was originally calculated.
    // Recompute WHT from the effective subtotal and transaction date so the
    // stored withholding never drifts from the bill base. Unrelated edits
    // (for example notes) leave the stored WHT untouched.
    const whtInputsChanged =
      apply_wht !== undefined ||
      wht_rate_code !== undefined ||
      items !== undefined ||
      issue_date !== undefined ||
      body_fx_rate !== undefined

    if (existingBill.status === "draft" && whtInputsChanged) {
      const effectiveWhtApplicable =
        apply_wht !== undefined ? Boolean(apply_wht) : Boolean(existingBill.wht_applicable)
      const effectiveWhtCode =
        wht_rate_code !== undefined ? wht_rate_code : existingBill.wht_rate_code
      const effectiveIssueDate =
        issue_date !== undefined ? issue_date : existingBill.issue_date

      if (effectiveWhtApplicable) {
        if (!effectiveWhtCode) {
          return NextResponse.json(
            {
              error: "Select a WHT category before applying withholding tax.",
              code: "WHT_CATEGORY_REQUIRED",
            },
            { status: 400 }
          )
        }

        let resolvedWhtRate
        try {
          resolvedWhtRate = await resolveWhtRateForDate(
            supabase,
            effectiveWhtCode,
            effectiveIssueDate
          )
        } catch (error) {
          if (error instanceof WhtRateResolutionError) {
            return NextResponse.json(
              { error: error.message, code: error.code },
              { status: 400 }
            )
          }
          throw error
        }

        const whtBaseAmount = Number(
          updateData.subtotal ?? existingBill.subtotal ?? 0
        )
        const effectiveFxRate =
          body_fx_rate !== undefined
            ? Number(body_fx_rate)
            : Number(existingBill.fx_rate || 0)
        const whtBaseGhs =
          effectiveFxRate > 0 ? whtBaseAmount * effectiveFxRate : whtBaseAmount
        const whtCalculation = calculateWHTForRate({
          baseAmount: whtBaseAmount,
          rate: resolvedWhtRate.rate,
          code: effectiveWhtCode,
          baseAmountGhs: whtBaseGhs,
        })

        updateData.wht_applicable = true
        updateData.wht_rate_code = effectiveWhtCode
        updateData.wht_rate = resolvedWhtRate.rate
        updateData.wht_amount = whtCalculation.whtAmount
      } else if (apply_wht === false) {
        updateData.wht_applicable = false
        updateData.wht_rate_code = null
        updateData.wht_rate = null
        updateData.wht_amount = 0
      }
    }

    if (
      isImportBill &&
      Object.prototype.hasOwnProperty.call(body, "material_id")
    ) {
      const mid =
        body_material_id != null && String(body_material_id).trim() !== ""
          ? String(body_material_id).trim()
          : null
      updateData.material_id = mid
      updateData.quantity =
        mid != null ? Number(body_import_quantity) || 1 : null
    }

    if (Object.prototype.hasOwnProperty.call(body, "supplier_id")) {
      const supplierLink = await resolveBillSupplierLink(
        supabase,
        billBusinessId,
        supplier_id
      )
      if (!supplierLink.ok) {
        return NextResponse.json(
          { error: supplierLink.error },
          { status: supplierLink.status }
        )
      }
      updateData.supplier_id = supplierLink.supplier_id
      if (!supplier_name?.trim() && supplierLink.name) {
        updateData.supplier_name = supplierLink.name
      }
      if (supplier_phone === undefined && supplierLink.phone) {
        updateData.supplier_phone = supplierLink.phone
      }
      if (supplier_email === undefined && supplierLink.email) {
        updateData.supplier_email = supplierLink.email
      }
    }
    if (supplier_name     !== undefined) updateData.supplier_name  = supplier_name.trim()
    if (supplier_phone    !== undefined) updateData.supplier_phone = supplier_phone?.trim() || null
    if (supplier_email    !== undefined) updateData.supplier_email = supplier_email?.trim() || null
    if (bill_number       !== undefined) updateData.bill_number    = bill_number.trim()
    if (issue_date        !== undefined) updateData.issue_date     = issue_date
    if (due_date          !== undefined) updateData.due_date       = due_date || null
    if (notes             !== undefined) updateData.notes          = notes?.trim() || null
    if (status            !== undefined) updateData.status         = status
    if (attachment_path   !== undefined) updateData.attachment_path = attachment_path || null

    const touchFx =
      Object.prototype.hasOwnProperty.call(body, "currency_code") ||
      Object.prototype.hasOwnProperty.call(body, "fx_rate")

    if (touchFx) {
      const { data: bizProf } = await supabase
        .from("businesses")
        .select("default_currency")
        .eq("id", billBusinessId)
        .maybeSingle()

      const homeCurrencyCode = bizProf?.default_currency
      if (!homeCurrencyCode) {
        return NextResponse.json(
          {
            error:
              "Business currency is required. Please set it in Business Profile settings.",
          },
          { status: 400 }
        )
      }

      const nextCode =
        "currency_code" in body
          ? body_currency_code
            ? String(body_currency_code).trim()
            : null
          : existingBill.currency_code
      const nextRateRaw =
        "fx_rate" in body ? body_fx_rate : existingBill.fx_rate
      const nextRate =
        nextRateRaw != null && nextRateRaw !== ""
          ? Number(nextRateRaw)
          : null
      const isFxBill = !!(nextCode && nextCode !== homeCurrencyCode)
      if (isFxBill && (!nextRate || nextRate <= 0)) {
        return NextResponse.json(
          {
            error: `Exchange rate is required for ${nextCode} bills. Please enter the current rate.`,
          },
          { status: 400 }
        )
      }

      const effectiveTotal =
        updateData.total !== undefined
          ? Number(updateData.total)
          : Number(existingBill.total ?? 0)

      updateData.currency_code = isFxBill ? nextCode : null
      updateData.currency_symbol = isFxBill
        ? getCurrencySymbol(nextCode!) || nextCode
        : null
      updateData.fx_rate = isFxBill ? nextRate : null
      updateData.home_currency_code = isFxBill ? homeCurrencyCode : null
      updateData.home_currency_total =
        isFxBill && nextRate
          ? Math.round(effectiveTotal * nextRate * 100) / 100
          : null
    }

    const { data: bill, error } = await supabase
      .from("bills")
      .update(updateData)
      .eq("id", billId)
      .select()
      .single()

    if (error) {
      console.error("Error updating bill:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Update line items for draft standard bills only (posted lines locked above)
    if (
      existingBill.status === "draft" &&
      !isImportBill &&
      items &&
      items.length > 0
    ) {
      await supabase.from("bill_items").delete().eq("bill_id", billId)

      const hasMaterialLines = items.some(
        (item: any) =>
          item.material_id != null && String(item.material_id).trim() !== ""
      )
      let materialCoaId: string | null = null
      if (hasMaterialLines) {
        const resolved = await resolveMaterialInventoryAccount(
          supabase,
          billBusinessId
        )
        if (!resolved.ok) {
          return NextResponse.json(
            {
              error: resolved.error,
              code: resolved.code,
            },
            { status: 400 }
          )
        }
        materialCoaId = resolved.chartOfAccountsId
      }

      // bill_items.account_id → chart_of_accounts(id). Materials store CoA 1450.
      const billItems = items.map((item: any) => {
        const mid =
          item.material_id != null && String(item.material_id).trim() !== ""
            ? String(item.material_id).trim()
            : null
        return {
          bill_id: billId,
          description: item.description || "",
          qty: Number(item.qty) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
          line_subtotal:
            (Number(item.qty) || 0) * (Number(item.unit_price) || 0) -
            (Number(item.discount_amount) || 0),
          material_id: mid,
          account_id: mid ? materialCoaId : item.account_id || null,
        }
      })

      await supabase.from("bill_items").insert(billItems)
    }

    // Log audit entry
    try {
      if (bill) {
        await createAuditLog({
          businessId: billBusinessId,
          userId: user?.id || null,
          actionType: "bill.updated",
          entityType: "bill",
          entityId: billId,
          oldValues: existingBill,
          newValues: bill,
          request,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    if (
      bill &&
      (bill as { status?: string }).status === "open" &&
      (existingBill as { status?: string }).status !== "open"
    ) {
      const { waitUntil } = await import("@vercel/functions")
      const { fireAfterAccountingPost } = await import("@/lib/server/fireAfterAccountingPost")
      fireAfterAccountingPost({
        businessId: (bill as { business_id: string }).business_id,
        journalDate: (bill as { issue_date?: string }).issue_date,
        source: "bill_post",
        supabase,
        scheduleBackground: (p) => waitUntil(p),
      })
    }

    return NextResponse.json({ bill })
  } catch (error: any) {
    console.error("Error updating bill:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: bill, error: billLookupError } = await supabase
      .from("bills")
      .select("status, business_id")
      .eq("id", billId)
      .is("deleted_at", null)
      .maybeSingle()

    if (billLookupError || !bill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

    const billBusinessId = String(bill.business_id)

    const denied = await enforceServiceWorkspaceWriteAccess({
      supabase, userId: user.id, businessId: billBusinessId, minTier: "professional",
    })
    if (denied) return denied

    if (bill.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft bills can be deleted" },
        { status: 400 }
      )
    }

    // Soft delete
    const { error } = await supabase
      .from("bills")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", billId)
      .eq("business_id", billBusinessId)

    if (error) {
      console.error("Error deleting bill:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      await createAuditLog({
        businessId: billBusinessId,
        userId: user?.id || null,
        actionType: "bill.deleted",
        entityType: "bill",
        entityId: billId,
        oldValues: bill,
        newValues: null,
        request,
        description: `Bill ${billId} deleted`,
      })
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ message: "Bill deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting bill:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

