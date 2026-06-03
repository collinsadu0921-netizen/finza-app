import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Return YYYY-MM-DD for the given instant in an IANA timezone.
 */
export function getDateInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    const parts = formatter.formatToParts(date)
    const year = parts.find((p) => p.type === "year")?.value ?? "0000"
    const month = parts.find((p) => p.type === "month")?.value ?? "01"
    const day = parts.find((p) => p.type === "day")?.value ?? "01"
    return `${year}-${month}-${day}`
  } catch {
    return date.toISOString().split("T")[0]
  }
}

/** Today in the business timezone (falls back to UTC). */
export async function getBusinessToday(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const { data: bizRow } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle()
  const tz = (bizRow?.timezone ?? "UTC").trim() || "UTC"
  return getDateInTimezone(new Date(), tz)
}
