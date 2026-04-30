import { getSupabaseServiceRoleClient } from "@/lib/supabaseServiceRole"
import AkwasiDashboard from "./AkwasiDashboard"
import type { FounderBriefingRow } from "./founderBriefingTypes"

export const metadata = {
  title: "Akwasi | Finza",
}

export default async function FounderAkwasiPage() {
  const admin = getSupabaseServiceRoleClient()
  let initialBriefing: FounderBriefingRow | null = null
  if (admin) {
    const { data } = await admin
      .from("founder_briefings")
      .select(
        "id,briefing_date,summary,priorities,risks,blockers,recommended_actions,decision_highlights,area_overview,created_at"
      )
      .order("briefing_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    initialBriefing = (data as FounderBriefingRow | null) ?? null
  }

  return <AkwasiDashboard initialBriefing={initialBriefing} />
}
