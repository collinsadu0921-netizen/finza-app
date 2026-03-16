import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { createAuditLog } from "@/lib/auditLog"

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
      status = "draft",
      attachment_path,
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
    if (!items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one bill item is required" },
        { status: 400 }
      )
    }

    // AUTH DISABLED FOR DEVELOPMENT - Bypass business ownership check
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business || business.id !== business_id) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    // }

    // Calculate totals using Ghana Tax Engine
    // For bills, the line items represent amounts that INCLUDE taxes (like expenses)
    // So we calculate subtotal first, then reverse-calculate base if taxes are applied
    const subtotalIncludingTaxes = items.reduce((sum: number, item: any) => {
      const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
      const discount = Number(item.discount_amount) || 0
      return sum + lineTotal - discount
    }, 0)

    let taxResult
    if (apply_taxes) {
      // Reverse-calculate: total includes taxes, so extract base amount
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
        grandTotal: subtotalIncludingTaxes, // Total stays the same (includes taxes)
      }
    } else {
      taxResult = {
        subtotalBeforeTax: subtotalIncludingTaxes,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        totalTax: 0,
        grandTotal: subtotalIncludingTaxes,
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
        status: finalStatus,
        attachment_path: attachment_path || null,
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

    // Create bill items
    const billItems = items.map((item: any) => ({
      bill_id: bill.id,
      description: item.description || "",
      qty: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_amount: Number(item.discount_amount) || 0,
      line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
    }))

    const { error: itemsError } = await supabase
      .from("bill_items")
      .insert(billItems)

    if (itemsError) {
      console.error("Error creating bill items:", itemsError)
      // Delete the bill if items fail
      await supabase.from("bills").delete().eq("id", bill.id)
      return NextResponse.json(
        { 
          success: false,
          error: itemsError.message || "Failed to create bill items. Please check item details.",
          details: itemsError
        },
        { status: 500 }
      )
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

