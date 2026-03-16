import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { createAuditLog } from "@/lib/auditLog"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle Next.js 16 params (can be a Promise)
    const resolvedParams = await Promise.resolve(params)
    const billId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    const { data: bill, error } = await supabase
      .from("bills")
      .select("*, business_id")
      .eq("id", billId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (error || !bill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

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
    const balance = Number(bill.total) - totalPaid

    return NextResponse.json({
      bill,
      items: items || [],
      payments: payments || [],
      total_paid: totalPaid,
      balance: balance,
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
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    const body = await request.json()
    const {
      supplier_name,
      supplier_phone,
      supplier_email,
      bill_number,
      issue_date,
      due_date,
      notes,
      items,
      apply_taxes,
      status,
      attachment_path,
    } = body

    // Verify bill exists
    const { data: existingBill } = await supabase
      .from("bills")
      .select("id, status")
      .eq("id", billId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
      .single()

    if (!existingBill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

    // If updating items, recalculate totals
    let updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (items && items.length > 0) {
      // For bills, line items represent amounts that INCLUDE taxes (like expenses)
      const subtotalIncludingTaxes = items.reduce((sum: number, item: any) => {
        const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
        const discount = Number(item.discount_amount) || 0
        return sum + lineTotal - discount
      }, 0)

      let taxResult
      if (apply_taxes !== undefined ? apply_taxes : true) {
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

      updateData.subtotal = taxResult.subtotalBeforeTax
      updateData.nhil = taxResult.nhil
      updateData.getfund = taxResult.getfund
      updateData.covid = taxResult.covid
      updateData.vat = taxResult.vat
      updateData.total_tax = taxResult.totalTax
      updateData.total = taxResult.grandTotal
    }

    if (supplier_name !== undefined) updateData.supplier_name = supplier_name.trim()
    if (supplier_phone !== undefined) updateData.supplier_phone = supplier_phone?.trim() || null
    if (supplier_email !== undefined) updateData.supplier_email = supplier_email?.trim() || null
    if (bill_number !== undefined) updateData.bill_number = bill_number.trim()
    if (issue_date !== undefined) updateData.issue_date = issue_date
    if (due_date !== undefined) updateData.due_date = due_date || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null
    if (status !== undefined) updateData.status = status
    if (attachment_path !== undefined) updateData.attachment_path = attachment_path || null

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

    // Update items if provided
    if (items && items.length > 0) {
      // Delete existing items
      await supabase.from("bill_items").delete().eq("bill_id", billId)

      // Insert new items
      const billItems = items.map((item: any) => ({
        bill_id: billId,
        description: item.description || "",
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_amount: Number(item.discount_amount) || 0,
        line_subtotal: (Number(item.qty) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount_amount) || 0),
      }))

      await supabase.from("bill_items").insert(billItems)
    }

    // Log audit entry
    try {
      const business = await getCurrentBusiness(supabase, user?.id || "")
      if (business && bill) {
        await createAuditLog({
          businessId: business.id,
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
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT
    // const business = await getCurrentBusiness(supabase, user.id)
    // if (!business) {
    //   return NextResponse.json({ error: "Business not found" }, { status: 404 })
    // }

    // Only allow deletion of draft bills
    const { data: bill } = await supabase
      .from("bills")
      .select("status")
      .eq("id", billId)
      // AUTH DISABLED FOR DEVELOPMENT
      // .eq("business_id", business.id)
      .single()

    if (!bill) {
      return NextResponse.json(
        { error: "Bill not found" },
        { status: 404 }
      )
    }

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

    if (error) {
      console.error("Error deleting bill:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      const business = await getCurrentBusiness(supabase, user?.id || "")
      if (business) {
        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "bill.deleted",
          entityType: "bill",
          entityId: billId,
          oldValues: bill,
          newValues: null,
          request,
          description: `Bill ${billId} deleted`,
        })
      }
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

