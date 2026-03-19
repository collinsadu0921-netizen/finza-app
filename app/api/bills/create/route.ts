import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { createAuditLog } from "@/lib/auditLog"
import { getCurrencySymbol } from "@/lib/currency"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT - Keep login check only
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    const body = await request.json()
    const {
      business_id,
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
    } = body

    // Validate required fields
    if (!business_id) {
      return NextResponse.json(
        { success: false, error: "Business ID is required" },
        { status: 400 }
      )
    }
    if (!supplier_name || !supplier_name.trim()) {
      return NextResponse.json(
        { success: false, error: "Supplier name is required" },
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

    // AUTH DISABLED FOR DEVELOPMENT - Bypass business ownership check
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business || business.id !== business_id) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    // }

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

    // Determine initial status
    let finalStatus = status
    if (status === "draft") {
      finalStatus = "draft"
    } else {
      finalStatus = "open"
    }

    // Create bill
    const { data: bill, error: billError } = await supabase
      .from("bills")
      .insert({
        business_id,
        supplier_name: supplier_name.trim(),
        supplier_phone: supplier_phone?.trim() || null,
        supplier_email: supplier_email?.trim() || null,
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
        status: finalStatus,
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
      const billItems = items.map((item: any) => ({
        bill_id: bill.id,
        description: item.description || "",
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
      }))

      const { error: itemsError } = await supabase.from("bill_items").insert(billItems)

      if (itemsError) {
        console.error("Error creating bill items:", itemsError)
        await supabase.from("bills").delete().eq("id", bill.id)
        return NextResponse.json(
          { success: false, error: itemsError.message || "Failed to create bill items.", details: itemsError },
          { status: 500 }
        )
      }
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

