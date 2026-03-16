import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get staff
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("*")
      .eq("id", staffId)
      .single()

    if (staffError || !staff) {
      return NextResponse.json(
        { error: "Staff not found" },
        { status: 404 }
      )
    }

    // Get allowances
    const { data: allowances, error: allowancesError } = await supabase
      .from("allowances")
      .select("*")
      .eq("staff_id", staffId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (allowancesError) {
      console.error("Error fetching allowances:", allowancesError)
    }

    // Get deductions
    const { data: deductions, error: deductionsError } = await supabase
      .from("deductions")
      .select("*")
      .eq("staff_id", staffId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (deductionsError) {
      console.error("Error fetching deductions:", deductionsError)
    }

    return NextResponse.json({
      staff,
      allowances: allowances || [],
      deductions: deductions || [],
    })
  } catch (error: any) {
    console.error("Error fetching staff:", error)
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
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

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
      status,
    } = body

    const updateData: any = {}
    if (name) updateData.name = name.trim()
    if (position !== undefined) updateData.position = position?.trim() || null
    if (phone !== undefined) updateData.phone = phone?.trim() || null
    if (whatsapp_phone !== undefined) updateData.whatsapp_phone = whatsapp_phone?.trim() || null
    if (email !== undefined) updateData.email = email?.trim() || null
    if (basic_salary !== undefined) updateData.basic_salary = Number(basic_salary)
    if (start_date) updateData.start_date = start_date
    if (employment_type) updateData.employment_type = employment_type
    if (bank_name !== undefined) updateData.bank_name = bank_name?.trim() || null
    if (bank_account !== undefined) updateData.bank_account = bank_account?.trim() || null
    if (ssnit_number !== undefined) updateData.ssnit_number = ssnit_number?.trim() || null
    if (tin_number !== undefined) updateData.tin_number = tin_number?.trim() || null
    if (status) updateData.status = status

    const { data: staff, error } = await supabase
      .from("staff")
      .update(updateData)
      .eq("id", staffId)
      .select()
      .single()

    if (error) {
      console.error("Error updating staff:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ staff })
  } catch (error: any) {
    console.error("Error updating staff:", error)
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
    const resolvedParams = await Promise.resolve(params)
    const staffId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { error } = await supabase
      .from("staff")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", staffId)

    if (error) {
      console.error("Error deleting staff:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: "Staff deleted successfully" })
  } catch (error: any) {
    console.error("Error deleting staff:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


