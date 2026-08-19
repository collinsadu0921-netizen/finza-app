import { createSupabaseServerClient } from "@/lib/supabaseServer"
import {
  resolvePracticeClientBooksContext,
  type PracticeClientBooksContext,
} from "@/lib/practice/resolvePracticeClientBooksContext"

export async function loadPracticeClientBooksPage(
  searchParams: Promise<{ business_id?: string }>
): Promise<{ context: PracticeClientBooksContext; businessId: string | null }> {
  const params = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { context: { kind: "denied", reason: "UNAUTHENTICATED" }, businessId: null }
  }

  const context = await resolvePracticeClientBooksContext({
    supabase,
    userId: user.id,
    urlBusinessId: params.business_id,
  })

  const businessId =
    context.kind === "practice" || context.kind === "service" ? context.businessId : null

  return { context, businessId }
}
