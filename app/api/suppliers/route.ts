import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import {
  isSupplierPaymentPreference,
  isSupplierPaymentTermsType,
} from "@/lib/retail/supplierRetailFields"

/**
 * POST /api/suppliers
 * Create a new supplier
 */
export async function POST(request: NextRequest) {
  try {
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

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Supplier name is required" },
        { status: 400 }
      )
    }

    const trim = (v: unknown) => {
      if (v === undefined || v === null) return null
      if (typeof v !== "string") return null
      const t = v.trim()
      return t.length ? t : null
    }

    if (payment_preference != null && payment_preference !== "") {
      if (!isSupplierPaymentPreference(payment_preference)) {
        return NextResponse.json({ error: "Invalid payment_preference" }, { status: 400 })
      }
    }
    if (payment_terms_type != null && payment_terms_type !== "") {
      if (!isSupplierPaymentTermsType(payment_terms_type)) {
        return NextResponse.json({ error: "Invalid payment_terms_type" }, { status: 400 })
      }
    }

    let leadVal: number | null = null
    if (lead_time_days !== undefined && lead_time_days !== null && lead_time_days !== "") {
      const n = typeof lead_time_days === "number" ? lead_time_days : Number(lead_time_days)
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return NextResponse.json(
          { error: "lead_time_days must be an integer between 0 and 365" },
          { status: 400 }
        )
      }
      leadVal = n
    }

    const insertRow: Record<string, unknown> = {
      business_id: business.id,
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      status: status || "active",
      contact_person: trim(contact_person),
      whatsapp_phone: trim(whatsapp_phone),
      location_line: trim(location_line),
      payment_preference:
        payment_preference && isSupplierPaymentPreference(payment_preference) ? payment_preference : null,
      payment_terms_type:
        payment_terms_type && isSupplierPaymentTermsType(payment_terms_type) ? payment_terms_type : null,
      payment_terms_custom:
        payment_terms_type === "custom" ? trim(payment_terms_custom) : null,
      notes: trim(notes),
      momo_number: trim(momo_number),
      momo_network: trim(momo_network),
      bank_account_name: trim(bank_account_name),
      bank_name: trim(bank_name),
      bank_account_number: trim(bank_account_number),
      tax_id: trim(tax_id),
      lead_time_days: leadVal,
      regular_products_note: trim(regular_products_note),
    }

    const { data: supplier, error } = await supabase.from("suppliers").insert(insertRow).select().single()

    if (error) {
      console.error("Error creating supplier:", error)
      return NextResponse.json(
        { error: "Failed to create supplier" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      supplier,
    })
  } catch (error: any) {
    console.error("Error in POST /api/suppliers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/suppliers
 * List suppliers for the business
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status")

    let query = supabase
      .from("suppliers")
      .select("*")
      .eq("business_id", business.id)
      .order("name", { ascending: true })

    if (status === "active" || status === "blocked") {
      query = query.eq("status", status)
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`
      query = query.or(
        `name.ilike.${term},phone.ilike.${term},email.ilike.${term},contact_person.ilike.${term},whatsapp_phone.ilike.${term},location_line.ilike.${term},notes.ilike.${term},momo_number.ilike.${term}`
      )
    }

    const { data: suppliers, error } = await query

    if (error) {
      console.error("Error loading suppliers:", error)
      return NextResponse.json(
        { error: "Failed to load suppliers" },
        { status: 500 }
      )
    }

    return NextResponse.json({ suppliers: suppliers || [] })
  } catch (error: any) {
    console.error("Error in GET /api/suppliers:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
