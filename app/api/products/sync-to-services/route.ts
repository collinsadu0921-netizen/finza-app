import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { business_id } = body

    if (!business_id) {
      return NextResponse.json({ error: "Business ID is required" }, { status: 400 })
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase, userId: user.id, businessId: business_id, minTier: "starter",
    })
    if (denied) return denied

    // Re-verify the business is a service business (tier check already passed above,
    // but this ensures sync is only triggered on the right industry type)
    const { data: business } = await supabase
      .from("businesses")
      .select("industry")
      .eq("id", business_id)
      .single()

    if (!business || business.industry !== "service") {
      return NextResponse.json({ error: "This sync is only for service businesses" }, { status: 400 })
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price")
      .eq("business_id", business_id)
      .order("name", { ascending: true })

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 })
    }

    if (!products || products.length === 0) {
      return NextResponse.json({ success: true, message: "No products to sync", synced: 0 })
    }

    let synced = 0
    let errors = 0

    for (const product of products) {
      const { data: existing } = await supabase
        .from("products_services")
        .select("id")
        .eq("business_id", business_id)
        .eq("name", product.name)
        .maybeSingle()

      if (!existing) {
        const { error: insertError } = await supabase
          .from("products_services")
          .insert({
            business_id,
            name:           product.name,
            unit_price:     Number(product.price) || 0,
            type:           "service",
            tax_applicable: true,
          })

        if (insertError) {
          console.error(`Failed to sync product ${product.name}:`, insertError)
          errors++
        } else {
          synced++
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${synced} products to products_services`,
      synced,
      errors,
      total: products.length,
    })
  } catch (error: any) {
    console.error("Error syncing products:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
