import { NextRequest, NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { fireAfterAccountingPost } from "@/lib/server/fireAfterAccountingPost"
import {
  getIncomingDocumentForBusiness,
  linkIncomingDocumentToEntity,
} from "@/lib/documents/incomingDocumentsService"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { createAuditLog } from "@/lib/auditLog"
import { getCurrencySymbol } from "@/lib/currency"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { resolveMaterialInventoryAccount } from "@/lib/bills/resolveMaterialInventoryAccount"

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id,
      supplier_id = null,
      supplier_name,
      supplier_phone,
      supplier_email,
      bill_number,
      issue_date,
      due_date,
      notes,
      items,
      apply_taxes = true,
      apply_wht = false,
      wht_rate_code = null,
      wht_rate = null,
      wht_amount = 0,
      status = "draft",
      attachment_path,
      // Import bill fields
      bill_type = "standard",
      import_description = null,
      cif_value = null,
      import_duty_rate = 0,
      import_duty_amount = 0,
      ecowas_levy = 0,
      au_levy = 0,
      exim_levy = 0,
      sil_levy = 0,
      examination_fee = 0,
      clearing_agent_fee = 0,
      landed_cost_account_code = "5200",
      // FX fields
      currency_code,
      fx_rate,
      // Import bill inventory linkage
      material_id: import_material_id = null,
      quantity: import_quantity = 1,
      incoming_document_id,
      // Unsupported bill-level discount fields (use line item discount_amount)
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
          success: false,
          error: headerDiscountRejection.error,
          code: headerDiscountRejection.code,
        },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!business_id) {
      return NextResponse.json(
        { success: false, error: "Business ID is required" },
        { status: 400 }
      )
    }
    if ((!supplier_name || !supplier_name.trim()) && !supplier_id) {
      return NextResponse.json(
        { success: false, error: "Supplier name is required (or choose an existing supplier)" },
        { status: 400 }
      )
    }
    if (!bill_number || !bill_number.trim()) {
      return NextResponse.json(
        { success: false, error: "Bill number is required" },
        { status: 400 }
      )
    }
    if (!issue_date) {
      return NextResponse.json(
        { success: false, error: "Issue date is required" },
        { status: 400 }
      )
    }
    if (bill_type === "standard" && (!items || items.length === 0)) {
      return NextResponse.json(
        { success: false, error: "At least one bill item is required" },
        { status: 400 }
      )
    }
    if (bill_type === "import" && (!cif_value || Number(cif_value) <= 0)) {
      return NextResponse.json(
        { success: false, error: "CIF value is required for import bills" },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business || business.id !== business_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const tierDenied = await enforceServiceIndustryMinTierWrite(
      supabase,
      user.id,
      business_id,
      "professional"
    )
    if (tierDenied) return tierDenied

    let supplierNameValue = supplier_name?.trim() || ""
    let supplierPhoneValue = supplier_phone?.trim() || null
    let supplierEmailValue = supplier_email?.trim() || null

    if (supplier_id) {
      const { data: supplierRow, error: supplierError } = await supabase
        .from("suppliers")
        .select("id, name, phone, email")
        .eq("id", supplier_id)
        .eq("business_id", business_id)
        .maybeSingle()

      if (supplierError || !supplierRow) {
        return NextResponse.json(
          { success: false, error: "Selected supplier not found for this business" },
          { status: 400 }
        )
      }

      if (!supplierNameValue) supplierNameValue = supplierRow.name
      if (!supplierPhoneValue) supplierPhoneValue = supplierRow.phone
      if (!supplierEmailValue) supplierEmailValue = supplierRow.email
    }

    // Resolve home currency for FX validation
    const { data: businessProfile } = await supabase
      .from("businesses")
      .select("default_currency")
      .eq("id", business_id)
      .single()

    const homeCurrencyCode = businessProfile?.default_currency || null
    const parsedFxRate = fx_rate ? Number(fx_rate) : null
    const isFxBill = !!(currency_code && homeCurrencyCode && currency_code !== homeCurrencyCode)

    if (isFxBill && (!parsedFxRate || parsedFxRate <= 0)) {
      return NextResponse.json(
        { success: false, error: `Exchange rate is required for ${currency_code} bills. Please enter the current rate.` },
        { status: 400 }
      )
    }

    const fxCurrencySymbol = isFxBill ? (getCurrencySymbol(currency_code) || currency_code) : null

    // Calculate totals using Ghana Tax Engine
    let taxResult

    if (bill_type === "import") {
      // Import bill: VAT/NHIL/GETFund applied ON TOP of the VAT base
      // VAT base = CIF + import duty + all port levies
      // The user enters CIF-inclusive total; taxes are added on top by ICUMS
      // Round the sum explicitly — Number() parsing + addition can produce
      // floating-point noise (e.g. 150.07000000000002) which would taint the tax calc.
      const vatBase = Math.round((
        Number(cif_value) + Number(import_duty_amount)
        + Number(ecowas_levy) + Number(au_levy)
        + Number(exim_levy) + Number(sil_levy) + Number(examination_fee)
      ) * 100) / 100

      if (apply_taxes) {
        // For imports, taxes are applied ON TOP (exclusive), not extracted from total
        const importTax = calculateGhanaTaxesFromLineItems([{ quantity: 1, unit_price: vatBase }])
        taxResult = {
          subtotalBeforeTax: vatBase,
          nhil: importTax.nhil ?? 0,
          getfund: importTax.getfund ?? 0,
          covid: 0,
          vat: importTax.vat ?? 0,
          totalTax: importTax.totalTax ?? 0,
          grandTotal: vatBase + (importTax.totalTax ?? 0) + Number(clearing_agent_fee),
        }
      } else {
        taxResult = {
          subtotalBeforeTax: vatBase,
          nhil: 0, getfund: 0, covid: 0, vat: 0, totalTax: 0,
          grandTotal: vatBase + Number(clearing_agent_fee),
        }
      }
    } else {
      // Standard bill: line items come in tax-inclusive, extract base.
      // Round each line contribution before accumulating to prevent float noise.
      const subtotalIncludingTaxes = Math.round((items ?? []).reduce((sum: number, item: any) => {
        const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
        const discount = Number(item.discount_amount) || 0
        return sum + Math.round((lineTotal - discount) * 100) / 100
      }, 0) * 100) / 100

      if (apply_taxes) {
        const { baseAmount, taxBreakdown } = calculateBaseFromTotalIncludingTaxes(
          subtotalIncludingTaxes,
          true
        )
        taxResult = {
          subtotalBeforeTax: baseAmount,
          nhil: taxBreakdown.nhil,
          getfund: taxBreakdown.getfund,
          covid: taxBreakdown.covid,
          vat: taxBreakdown.vat,
          totalTax: taxBreakdown.totalTax,
          grandTotal: subtotalIncludingTaxes,
        }
      } else {
        taxResult = {
          subtotalBeforeTax: subtotalIncludingTaxes,
          nhil: 0, getfund: 0, covid: 0, vat: 0, totalTax: 0,
          grandTotal: subtotalIncludingTaxes,
        }
      }
    }

    // Standard bills: always insert as draft, then insert lines, then open if requested
    // so the post trigger never runs before bill_items exist.
    const wantsOpen = status !== "draft"
    const insertStatus = bill_type === "standard" ? "draft" : wantsOpen ? "open" : "draft"

    // Create bill
    let { data: bill, error: billError } = await supabase
      .from("bills")
      .insert({
        business_id,
        supplier_id: supplier_id || null,
        supplier_name: supplierNameValue,
        supplier_phone: supplierPhoneValue,
        supplier_email: supplierEmailValue,
        bill_number: bill_number.trim(),
        issue_date,
        due_date: due_date || null,
        notes: notes?.trim() || null,
        subtotal: taxResult.subtotalBeforeTax,
        nhil: taxResult.nhil,
        getfund: taxResult.getfund,
        covid: taxResult.covid,
        vat: taxResult.vat,
        total_tax: taxResult.totalTax,
        total: taxResult.grandTotal,
        wht_applicable: apply_wht,
        wht_rate_code: apply_wht ? wht_rate_code : null,
        wht_rate: apply_wht ? wht_rate : null,
        wht_amount: apply_wht ? wht_amount : 0,
        status: insertStatus,
        attachment_path: attachment_path || null,
        // Import bill fields
        bill_type,
        import_description: bill_type === "import" ? import_description : null,
        cif_value: bill_type === "import" ? Number(cif_value) : null,
        import_duty_rate: bill_type === "import" ? Number(import_duty_rate) : 0,
        import_duty_amount: bill_type === "import" ? Number(import_duty_amount) : 0,
        ecowas_levy: bill_type === "import" ? Number(ecowas_levy) : 0,
        au_levy: bill_type === "import" ? Number(au_levy) : 0,
        exim_levy: bill_type === "import" ? Number(exim_levy) : 0,
        sil_levy: bill_type === "import" ? Number(sil_levy) : 0,
        examination_fee: bill_type === "import" ? Number(examination_fee) : 0,
        clearing_agent_fee: bill_type === "import" ? Number(clearing_agent_fee) : 0,
        landed_cost_account_code: bill_type === "import" ? landed_cost_account_code : "5200",
        // Import inventory linkage
        material_id: bill_type === "import" ? (import_material_id || null) : null,
        quantity: bill_type === "import" ? Number(import_quantity) || 1 : null,
        // FX fields
        currency_code: isFxBill ? currency_code : null,
        currency_symbol: isFxBill ? fxCurrencySymbol : null,
        fx_rate: isFxBill ? parsedFxRate : null,
        home_currency_code: isFxBill ? homeCurrencyCode : null,
        home_currency_total: isFxBill && parsedFxRate
          ? Math.round(taxResult.grandTotal * parsedFxRate * 100) / 100
          : null,
      })
      .select()
      .single()

    if (billError) {
      console.error("Error creating bill:", billError)
      return NextResponse.json(
        { 
          success: false,
          error: billError.message || "Failed to create bill. Please check all fields are correct.",
          details: billError
        },
        { status: 500 }
      )
    }

    if (!bill || !bill.id) {
      console.error("Bill created but no ID returned")
      return NextResponse.json(
        { 
          success: false,
          error: "Bill was created but no ID was returned. Please try again."
        },
        { status: 500 }
      )
    }

    // Create bill items (standard bills only — import bills use the breakdown fields)
    if (bill_type === "standard" && items?.length > 0) {
      const hasMaterialLines = items.some(
        (item: any) =>
          item.material_id != null && String(item.material_id).trim() !== ""
      )
      let materialCoaId: string | null = null
      if (hasMaterialLines) {
        const resolved = await resolveMaterialInventoryAccount(
          supabase,
          business_id
        )
        if (!resolved.ok) {
          const { error: cleanupError } = await supabase
            .from("bills")
            .delete()
            .eq("id", bill.id)
          return NextResponse.json(
            {
              success: false,
              error: resolved.error,
              code: resolved.code,
              ...(cleanupError
                ? {
                    cleanup_failed: true,
                    bill_id: bill.id,
                    cleanup_error: cleanupError.message,
                  }
                : {}),
            },
            { status: 400 }
          )
        }
        materialCoaId = resolved.chartOfAccountsId
      }

      // bill_items.account_id → chart_of_accounts(id). Materials store CoA 1450;
      // post_bill_to_ledger still routes material_id lines to accounts.code 1450
      // even if an older row has a null account_id.
      const billItems = items.map((item: any) => {
        const mid =
          item.material_id != null && String(item.material_id).trim() !== ""
            ? String(item.material_id).trim()
            : null
        return {
          bill_id: bill.id,
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

      const { error: itemsError } = await supabase.from("bill_items").insert(billItems)

      if (itemsError) {
        console.error("Error creating bill items:", itemsError)
        const { error: cleanupError } = await supabase
          .from("bills")
          .delete()
          .eq("id", bill.id)

        // Never open/post on line failure. If cleanup fails, bill remains draft
        // (cannot post without a later open) and the original insert error is reported.
        return NextResponse.json(
          {
            success: false,
            error: itemsError.message || "Failed to create bill items.",
            details: itemsError,
            ...(cleanupError
              ? {
                  cleanup_failed: true,
                  bill_id: bill.id,
                  cleanup_error: cleanupError.message,
                }
              : {}),
          },
          { status: 500 }
        )
      }
    }

    if (bill_type === "standard" && wantsOpen) {
      const { data: opened, error: openError } = await supabase
        .from("bills")
        .update({ status: "open" })
        .eq("id", bill.id)
        .eq("business_id", business_id)
        .select()
        .single()

      if (openError || !opened) {
        console.error("Error opening bill after lines:", openError)
        return NextResponse.json(
          {
            success: false,
            error: openError?.message || "Bill lines saved but failed to open bill for posting.",
            details: openError,
            bill_id: bill.id,
          },
          { status: 500 }
        )
      }
      bill = opened
    }

    // Log audit entry
    await createAuditLog({
      businessId: business_id,
      userId: user?.id || null,
      actionType: "bill.created",
      entityType: "bill",
      entityId: bill.id,
      oldValues: null,
      newValues: bill,
      request,
    })

    const incomingDocId =
      typeof incoming_document_id === "string" ? incoming_document_id.trim() : ""
    if (incomingDocId) {
      const doc = await getIncomingDocumentForBusiness(supabase, incomingDocId, business_id)
      const ap = typeof attachment_path === "string" ? attachment_path.trim() : ""
      if (doc && (!ap || doc.storage_path === ap)) {
        const linkRes = await linkIncomingDocumentToEntity(supabase, {
          documentId: incomingDocId,
          businessId: business_id,
          linkedEntityType: "bill",
          linkedEntityId: bill.id,
          expectedStoragePath: ap || doc.storage_path,
          actualFilePath: ap || doc.storage_path,
        })
        if (!linkRes.ok) {
          console.warn("[bills/create] incoming document link skipped:", linkRes.error)
        }
      } else if (doc && ap && doc.storage_path !== ap) {
        console.warn("[bills/create] incoming_document_id ignored: attachment_path does not match document")
      }
    }

    if (bill?.status === "open") {
      fireAfterAccountingPost({
        businessId: business_id,
        journalDate: bill.issue_date ?? issue_date,
        source: "bill_post",
        supabase,
        scheduleBackground: (p) => waitUntil(p),
      })
    }

    return NextResponse.json({ 
      success: true,
      bill,
      message: "Bill created successfully"
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating bill:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

