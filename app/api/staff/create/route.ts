import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

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
      position,
      phone,
      whatsapp_phone,
      email,
      basic_salary,
      start_date,
      employment_type,
      bank_name,
      bank_account,
      ssnit_number,
      tin_number,
    } = body

    if (!name || !basic_salary || !start_date) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const { data: staff, error } = await supabase
      .from("staff")
      .insert({
        business_id: business.id,
        name: name.trim(),
        position: position?.trim() || null,
        phone: phone?.trim() || null,
        whatsapp_phone: whatsapp_phone?.trim() || null,
        email: email?.trim() || null,
        basic_salary: Number(basic_salary),
        start_date,
        employment_type: employment_type || "full_time",
        bank_name: bank_name?.trim() || null,
        bank_account: bank_account?.trim() || null,
        ssnit_number: ssnit_number?.trim() || null,
        tin_number: tin_number?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      console.error("Error creating staff:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ staff }, { status: 201 })
  } catch (error: any) {
    console.error("Error creating staff:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


