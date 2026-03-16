import { SupabaseClient } from "@supabase/supabase-js"

export async function getCurrentBusiness(
  supabase: SupabaseClient,
  userId: string
) {
  // First, try to get business where user is owner (exclude archived)
  const { data: ownerBusiness, error: ownerError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ownerError && ownerBusiness) {
    return ownerBusiness
  }

  // If not owner, check business_users table (exclude archived businesses)
  const { data: businessUsers, error: buError } = await supabase
    .from("business_users")
    .select("business_id, businesses(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (!buError && businessUsers && businessUsers.length > 0) {
    const firstNonArchived = businessUsers.find((bu: any) => {
      const b = Array.isArray(bu.businesses) ? bu.businesses[0] : bu.businesses
      return b && b.archived_at == null
    })
    if (firstNonArchived) {
      const business = Array.isArray(firstNonArchived.businesses)
        ? firstNonArchived.businesses[0]
        : firstNonArchived.businesses
      return business as any
    }
  }

  // If no business found via either method, return null
  if (!ownerError && !ownerBusiness && (buError || !businessUsers?.length)) {
    return null
  }

  // Fallback to original logic for error handling (only if ownerError exists)
  if (ownerError) {
    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("owner_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      const errMsg = (error as { message?: string }).message
      const errCode = (error as { code?: string }).code

      // Benign/empty error (e.g. no rows from RLS) → treat as no business, don't throw
      if (!errMsg && !errCode) {
        return null
      }

      console.error("Error fetching business:", {
        message: errMsg,
        code: errCode,
        details: (error as { details?: string }).details,
        hint: (error as { hint?: string }).hint,
      })

      // If the error is about multiple rows, we can handle it gracefully
      if (errCode === "PGRST116" || errMsg?.includes("multiple")) {
        const { data: businessesData, error: businessesError } = await supabase
          .from("businesses")
          .select("*")
          .eq("owner_id", userId)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(1)

        if (businessesError) {
          const enhancedError = new Error(
            `Failed to fetch business: ${(businessesError as { message?: string }).message || (businessesError as { code?: string }).code || "Unknown error"}`
          ) as any
          enhancedError.code = (businessesError as { code?: string }).code
          enhancedError.details = (businessesError as { details?: string }).details
          enhancedError.hint = (businessesError as { hint?: string }).hint
          enhancedError.originalError = businessesError
          throw enhancedError
        }

        return businessesData && businessesData.length > 0 ? businessesData[0] : null
      }

      // Create a more informative error for other cases
      const enhancedError = new Error(
        `Failed to fetch business: ${errMsg || errCode || "Unknown error"}`
      ) as any
      enhancedError.code = errCode
      enhancedError.details = (error as { details?: string }).details
      enhancedError.hint = (error as { hint?: string }).hint
      enhancedError.originalError = error
      throw enhancedError
    }

    return data
  }

  // If we get here, no business was found
  return null
}


















