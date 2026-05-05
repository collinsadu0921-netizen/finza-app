import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { assertCountryCurrency } from "@/lib/countryCurrency"

/** Trim; empty / whitespace-only becomes "". */
function normStr(v: unknown): string {
  if (v === undefined || v === null) return ""
  return String(v).trim()
}

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

    const authEmail = normStr(user?.email)
    const rowEmail = normStr(business.email)
    const displayEmail = rowEmail || authEmail || null

    const rowTrading = normStr(business.trading_name)
    const rowName = normStr(business.name)
    const displayTrading = rowTrading || (rowName ? rowName : null)

    // Return all business profile fields
    return NextResponse.json({
      business: {
        id: business.id,
        name: business.name,
        industry: business.industry,
        legal_name: business.legal_name || null,
        trading_name: displayTrading,
        address_street: business.address_street || null,
        address_city: business.address_city || null,
        address_region: business.address_region || null,
        address_country: business.address_country || null,
        phone: business.phone || null,
        whatsapp_phone: business.whatsapp_phone || null,
        email: displayEmail,
        website: business.website || null,
        tin: business.tin || null,
        logo_url: business.logo_url || null,
        default_currency: business.default_currency || null,
        start_date: (business as any).start_date || null,
        cit_rate_code: (business as any).cit_rate_code || "standard_25",
        vat_scheme: (business as any).vat_scheme || "standard",
        business_type: (business as any).business_type || "limited_company",
        created_at: business.created_at || null,
        onboarding_step: (business as { onboarding_step?: string }).onboarding_step ?? null,
      },
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const preferredId = (body.business_id ?? null) as string | null
    const business = await getBusinessForProfile(supabase, user.id, preferredId ? String(preferredId).trim() : null)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const editorRole = await getUserRole(supabase, user.id, business.id)
    if (!canEditBusinessWideSensitiveSettings(editorRole)) {
      return NextResponse.json(
        { error: "Forbidden: only business owners and admins can update the business profile." },
        { status: 403 }
      )
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
      business_type,
    } = body

    const authEmail = normStr(user.email)

    // Validate required fields (trimmed)
    if (address_country !== undefined && !normStr(address_country)) {
      return NextResponse.json(
        { error: "Country is required. Please select your business country." },
        { status: 400 }
      )
    }

    if (default_currency !== undefined && !normStr(default_currency)) {
      return NextResponse.json(
        { error: "Default currency is required. Please select your business currency." },
        { status: 400 }
      )
    }

    const trimmedCountry =
      address_country !== undefined ? normStr(address_country) : undefined
    const trimmedCurrency =
      default_currency !== undefined ? normStr(default_currency) : undefined

    // Base currency immutability: cannot change after accounting activity has begun
    if (
      default_currency !== undefined &&
      trimmedCurrency !== undefined &&
      trimmedCurrency !== (business.default_currency || null)
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
    if (trimmedCountry !== undefined && trimmedCurrency !== undefined) {
      const countryCode = normalizeCountry(trimmedCountry)
      try {
        assertCountryCurrency(countryCode, trimmedCurrency)
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message || "Currency does not match country." },
          { status: 400 }
        )
      }
    } else if (trimmedCountry !== undefined) {
      const existingCurrency = business.default_currency
      if (existingCurrency) {
        const countryCode = normalizeCountry(trimmedCountry)
        try {
          assertCountryCurrency(countryCode, existingCurrency)
        } catch (error: any) {
          return NextResponse.json(
            { error: error.message || "Existing currency does not match new country." },
            { status: 400 }
          )
        }
      }
    } else if (trimmedCurrency !== undefined) {
      const existingCountry = business.address_country
      if (existingCountry) {
        const countryCode = normalizeCountry(existingCountry)
        try {
          assertCountryCurrency(countryCode, trimmedCurrency)
        } catch (error: any) {
          return NextResponse.json(
            { error: error.message || "Currency does not match existing country." },
            { status: 400 }
          )
        }
      }
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (legal_name !== undefined) {
      const v = normStr(legal_name)
      updateData.legal_name = v || null
    }
    if (trading_name !== undefined) {
      const t = normStr(trading_name)
      const nameFallback = normStr(business.name)
      updateData.trading_name = t || (nameFallback || null)
    }
    if (address_street !== undefined) {
      const v = normStr(address_street)
      updateData.address_street = v || null
    }
    if (address_city !== undefined) {
      const v = normStr(address_city)
      updateData.address_city = v || null
    }
    if (address_region !== undefined) {
      const v = normStr(address_region)
      updateData.address_region = v || null
    }
    if (address_country !== undefined) {
      updateData.address_country = trimmedCountry || null
    }
    if (phone !== undefined) {
      const v = normStr(phone)
      updateData.phone = v || null
    }
    if (whatsapp_phone !== undefined) {
      const v = normStr(whatsapp_phone)
      updateData.whatsapp_phone = v || null
    }
    if (email !== undefined) {
      const fromBody = normStr(email)
      updateData.email = fromBody || authEmail || normStr(business.email) || null
    }
    if (website !== undefined) {
      const v = normStr(website)
      updateData.website = v || null
    }
    if (tin !== undefined) {
      const v = normStr(tin)
      updateData.tin = v || null
    }
    if (logo_url !== undefined) {
      updateData.logo_url =
        logo_url === null || (typeof logo_url === "string" && logo_url.trim() === "") ? null : logo_url
    }
    if (default_currency !== undefined) {
      updateData.default_currency = trimmedCurrency || null
    }
    if (start_date !== undefined) {
      updateData.start_date = normStr(start_date) || null
    }
    if (cit_rate_code !== undefined) updateData.cit_rate_code = cit_rate_code
    if (vat_scheme !== undefined) updateData.vat_scheme = vat_scheme
    if (business_type !== undefined) updateData.business_type = business_type

    // Onboarding: validate effective identity + contact (trimmed; business.name + auth email count)
    if (business.onboarding_step === "business_profile") {
      const finalLegal =
        legal_name !== undefined ? normStr(legal_name) : normStr(business.legal_name as string)
      const finalTrading =
        trading_name !== undefined
          ? normStr(trading_name) || normStr(business.name as string)
          : normStr(business.trading_name as string) || normStr(business.name as string)
      const finalName = normStr(business.name as string)
      const effectiveBusinessIdentity = finalLegal || finalTrading || finalName

      const finalPhone =
        phone !== undefined ? normStr(phone) : normStr(business.phone as string)
      const finalEmail =
        email !== undefined
          ? normStr(email) || authEmail
          : normStr(business.email as string) || authEmail
      const effectiveContact = finalPhone || finalEmail

      if (!effectiveBusinessIdentity) {
        return NextResponse.json(
          {
            error:
              "Business name, legal name, or trading name is required. Complete business setup or enter at least one of these names.",
          },
          { status: 400 }
        )
      }

      if (!effectiveContact) {
        return NextResponse.json(
          {
            error: "Please provide at least one contact method: phone or email.",
          },
          { status: 400 }
        )
      }

      if (business.industry === "retail") {
        updateData.onboarding_step = "create_store"
      } else if (business.industry === "logistics") {
        updateData.onboarding_step = "add_rider"
      } else {
        updateData.onboarding_step = "industry_confirmation"
      }
    }

    let { data, error } = await supabase
      .from("businesses")
      .update(updateData as any)
      .eq("id", business.id)
      .select("*")
      .maybeSingle()

    // DB without migration 381: column business_type missing → PostgREST schema cache error.
    // Retry without business_type so onboarding / profile save still works; apply 381 for full support.
    const errText = String(error?.message ?? (error as { details?: string })?.details ?? "")
    if (
      error &&
      updateData.business_type !== undefined &&
      (errText.includes("business_type") || errText.includes("schema cache"))
    ) {
      const { business_type: _omit, ...updateWithoutType } = updateData
      const second = await supabase
        .from("businesses")
        .update(updateWithoutType as any)
        .eq("id", business.id)
        .select("*")
        .maybeSingle()
      data = second.data
      error = second.error
      if (!error) {
        console.warn(
          "[business/profile] Saved without business_type — run supabase migration 381_add_business_type.sql on this project."
        )
      }
    }

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
