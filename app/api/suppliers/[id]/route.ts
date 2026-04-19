import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import {
  isSupplierPaymentPreference,
  isSupplierPaymentTermsType,
} from "@/lib/retail/supplierRetailFields"

/**
 * GET /api/suppliers/[id]
 * Get supplier details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: supplierId } = await params
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

    // supplierId already extracted from params above

    const { data: supplier, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplierId)
      .eq("business_id", business.id)
      .single()

    if (error || !supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ supplier })
  } catch (error: any) {
    console.error("Error in GET /api/suppliers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/suppliers/[id]
 * Update supplier details
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: supplierId } = await params
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

    const body = await request.json()
    const {
      name,
      phone,
      email,
      status,
      contact_person,
      whatsapp_phone,
      location_line,
      payment_preference,
      payment_terms_type,
      payment_terms_custom,
      notes,
      momo_number,
      momo_network,
      bank_account_name,
      bank_name,
      bank_account_number,
      tax_id,
      lead_time_days,
      regular_products_note,
    } = body

    // Validate supplier exists
    const { data: existingSupplier, error: fetchError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", supplierId)
      .eq("business_id", business.id)
      .single()

    if (fetchError || !existingSupplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      )
    }

    // Build update object
    const updates: any = {}
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: "Supplier name cannot be empty" },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }
    if (phone !== undefined) {
      updates.phone = phone?.trim() || null
    }
    if (email !== undefined) {
      updates.email = email?.trim() || null
    }
    if (status !== undefined) {
      if (status !== "active" && status !== "blocked") {
        return NextResponse.json(
          { error: "Status must be 'active' or 'blocked'" },
          { status: 400 }
        )
      }
      updates.status = status
    }

    const trim = (v: unknown) => {
      if (v === undefined) return undefined
      if (v === null) return null
      if (typeof v !== "string") return null
      const t = v.trim()
      return t.length ? t : null
    }

    if (contact_person !== undefined) updates.contact_person = trim(contact_person)
    if (whatsapp_phone !== undefined) updates.whatsapp_phone = trim(whatsapp_phone)
    if (location_line !== undefined) updates.location_line = trim(location_line)
    if (notes !== undefined) updates.notes = trim(notes)
    if (momo_number !== undefined) updates.momo_number = trim(momo_number)
    if (momo_network !== undefined) updates.momo_network = trim(momo_network)
    if (bank_account_name !== undefined) updates.bank_account_name = trim(bank_account_name)
    if (bank_name !== undefined) updates.bank_name = trim(bank_name)
    if (bank_account_number !== undefined) updates.bank_account_number = trim(bank_account_number)
    if (tax_id !== undefined) updates.tax_id = trim(tax_id)
    if (regular_products_note !== undefined) updates.regular_products_note = trim(regular_products_note)

    if (payment_preference !== undefined) {
      if (payment_preference === null || payment_preference === "") {
        updates.payment_preference = null
      } else if (!isSupplierPaymentPreference(payment_preference)) {
        return NextResponse.json({ error: "Invalid payment_preference" }, { status: 400 })
      } else {
        updates.payment_preference = payment_preference
      }
    }

    if (payment_terms_type !== undefined) {
      if (payment_terms_type === null || payment_terms_type === "") {
        updates.payment_terms_type = null
        updates.payment_terms_custom = null
      } else if (!isSupplierPaymentTermsType(payment_terms_type)) {
        return NextResponse.json({ error: "Invalid payment_terms_type" }, { status: 400 })
      } else {
        updates.payment_terms_type = payment_terms_type
        if (payment_terms_type !== "custom") {
          updates.payment_terms_custom = null
        }
      }
    }

    if (payment_terms_custom !== undefined) {
      const t = trim(payment_terms_custom)
      const row = existingSupplier as { payment_terms_type?: string | null }
      const effectiveType =
        (payment_terms_type !== undefined ? payment_terms_type : row.payment_terms_type) || null
      if (effectiveType === "custom") {
        updates.payment_terms_custom = t
      }
    }

    if (lead_time_days !== undefined) {
      if (lead_time_days === null || lead_time_days === "") {
        updates.lead_time_days = null
      } else {
        const n = typeof lead_time_days === "number" ? lead_time_days : Number(lead_time_days)
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          return NextResponse.json(
            { error: "lead_time_days must be an integer between 0 and 365" },
            { status: 400 }
          )
        }
        updates.lead_time_days = n
      }
    }

    const { data: updatedSupplier, error: updateError } = await supabase
      .from("suppliers")
      .update(updates)
      .eq("id", supplierId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating supplier:", updateError)
      return NextResponse.json(
        { error: "Failed to update supplier" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      supplier: updatedSupplier,
    })
  } catch (error: any) {
    console.error("Error in PATCH /api/suppliers/[id]:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
