import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { assertCountryCurrency } from "@/lib/countryCurrency"

async function getBusinessForProfile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  preferredBusinessId: string | null
) {
  if (preferredBusinessId) {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", preferredBusinessId)
      .is("archived_at", null)
      .maybeSingle()
    if (error) return null
    if (!data) return null
    const isOwner = data.owner_id === userId
    if (isOwner) return data
    const { data: bu } = await supabase
      .from("business_users")
      .select("business_id")
      .eq("user_id", userId)
      .eq("business_id", preferredBusinessId)
      .limit(1)
      .maybeSingle()
    if (bu) return data
    return null
  }
  return getCurrentBusiness(supabase, userId)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const preferredId = request.nextUrl.searchParams.get("business_id")?.trim() ?? null
    const business = await getBusinessForProfile(supabase, user?.id || "", preferredId)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Return all business profile fields
    return NextResponse.json({ 
      business: {
        id: business.id,
        name: business.name,
        industry: business.industry,
        legal_name: business.legal_name || null,
        trading_name: business.trading_name || null,
        address_street: business.address_street || null,
        address_city: business.address_city || null,
        address_region: business.address_region || null,
        address_country: business.address_country || null,
        phone: business.phone || null,
        whatsapp_phone: business.whatsapp_phone || null,
        email: business.email || null,
        website: business.website || null,
        tin: business.tin || null,
        logo_url: business.logo_url || null,
        default_currency: business.default_currency || null,
        start_date: (business as any).start_date || null,
        cit_rate_code: (business as any).cit_rate_code || "standard_25",
        vat_scheme: (business as any).vat_scheme || "standard",
        created_at: business.created_at || null,
      }
    })
  } catch (error: any) {
    console.error("Error fetching business profile:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  return PUT(request)
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const body = await request.json()
    const preferredId = (body.business_id ?? null) as string | null
    const business = await getBusinessForProfile(supabase, user?.id || "", preferredId ? String(preferredId).trim() : null)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const {
      legal_name,
      trading_name,
      address_street,
      address_city,
      address_region,
      address_country,
      phone,
      whatsapp_phone,
      email,
      website,
      tin,
      logo_url,
      default_currency,
      start_date,
      cit_rate_code,
      vat_scheme,
    } = body

    // Validate required fields
    if (address_country !== undefined && !address_country) {
      return NextResponse.json(
        { error: "Country is required. Please select your business country." },
        { status: 400 }
      )
    }

    if (default_currency !== undefined && !default_currency) {
      return NextResponse.json(
        { error: "Default currency is required. Please select your business currency." },
        { status: 400 }
      )
    }

    // Base currency immutability: cannot change after accounting activity has begun
    if (
      default_currency !== undefined &&
      default_currency !== (business.default_currency || null)
    ) {
      const businessId = business.id

      const [invoiceResult, expenseResult, journalResult] = await Promise.all([
        supabase
          .from("invoices")
          .select("id")
          .eq("business_id", businessId)
          .in("status", ["sent", "paid", "overdue"])
          .limit(1),
        supabase.from("expenses").select("id").eq("business_id", businessId).limit(1),
        supabase.from("journal_entries").select("id").eq("business_id", businessId).limit(1),
      ])

      const hasPostedInvoice = invoiceResult.data && invoiceResult.data.length > 0
      const hasExpense = expenseResult.data && expenseResult.data.length > 0
      const hasLedgerEntry = journalResult.data && journalResult.data.length > 0

      if (hasPostedInvoice || hasExpense || hasLedgerEntry) {
        return NextResponse.json(
          {
            error:
              "Base currency cannot be changed after accounting activity has begun (invoices, expenses, or ledger entries exist).",
          },
          { status: 400 }
        )
      }
    }

    // Validate country-currency match if both are being updated
    if (address_country !== undefined && default_currency !== undefined) {
      const countryCode = normalizeCountry(address_country)
      try {
        assertCountryCurrency(countryCode, default_currency)
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message || "Currency does not match country." },
          { status: 400 }
        )
      }
    } else if (address_country !== undefined) {
      // Country is being updated, validate against existing currency
      const existingCurrency = business.default_currency
      if (existingCurrency) {
        const countryCode = normalizeCountry(address_country)
        try {
          assertCountryCurrency(countryCode, existingCurrency)
        } catch (error: any) {
          return NextResponse.json(
            { error: error.message || "Existing currency does not match new country." },
            { status: 400 }
          )
        }
      }
    } else if (default_currency !== undefined) {
      // Currency is being updated, validate against existing country
      const existingCountry = business.address_country
      if (existingCountry) {
        const countryCode = normalizeCountry(existingCountry)
        try {
          assertCountryCurrency(countryCode, default_currency)
        } catch (error: any) {
          return NextResponse.json(
            { error: error.message || "Currency does not match existing country." },
            { status: 400 }
          )
        }
      }
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (legal_name !== undefined) updateData.legal_name = legal_name
    if (trading_name !== undefined) updateData.trading_name = trading_name
    if (address_street !== undefined) updateData.address_street = address_street
    if (address_city !== undefined) updateData.address_city = address_city
    if (address_region !== undefined) updateData.address_region = address_region
    if (address_country !== undefined) updateData.address_country = address_country
    if (phone !== undefined) updateData.phone = phone
    if (whatsapp_phone !== undefined) updateData.whatsapp_phone = whatsapp_phone
    if (email !== undefined) updateData.email = email
    if (website !== undefined) updateData.website = website
    if (tin !== undefined) updateData.tin = tin
    if (logo_url !== undefined) updateData.logo_url = logo_url
    if (default_currency !== undefined) updateData.default_currency = default_currency
    if (start_date !== undefined) updateData.start_date = start_date || null
    if (cit_rate_code !== undefined) updateData.cit_rate_code = cit_rate_code
    if (vat_scheme !== undefined) updateData.vat_scheme = vat_scheme

    // ONBOARDING FIX: Advance onboarding_step when profile is saved during onboarding
    // This ensures onboarding always progresses after successful actions
    if (business.onboarding_step === "business_profile") {
      // VALIDATION: business.name must exist before onboarding can advance
      const hasBusinessName = business.name && business.name.trim() !== ""
      
      // VALIDATION: Required fields for onboarding progression
      const hasProfileData = (legal_name || trading_name) && (phone || email)
      
      // If in onboarding, enforce required fields - block save if missing
      if (!hasBusinessName) {
        return NextResponse.json(
          { error: "Business name is required. Please complete your business setup first." },
          { status: 400 }
        )
      }
      
      if (!hasProfileData) {
        return NextResponse.json(
          { error: "Phone or email is required to continue onboarding. Please provide at least one contact method." },
          { status: 400 }
        )
      }
      
      // All validations passed - advance to next step based on industry
      if (business.industry === "retail") {
        updateData.onboarding_step = "create_store"
      } else if (business.industry === "logistics") {
        updateData.onboarding_step = "add_rider"
      } else {
        // service or other: new flow goes to industry_confirmation next
        updateData.onboarding_step = "industry_confirmation"
      }
    }

    const { data, error } = await supabase
      .from("businesses")
      .update(updateData)
      .eq("id", business.id)
      .select("*")
      .maybeSingle()

    if (error) {
      console.error("Error updating business profile:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // RLS may allow UPDATE but not SELECT; return full object so client gets success
    if (!data) {
      return NextResponse.json({ business: { ...business, ...updateData } })
    }
    return NextResponse.json({ business: data })
  } catch (error: any) {
    console.error("Error updating business profile:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

