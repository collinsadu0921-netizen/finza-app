import { redirect } from "next/navigation"
import { buildServiceRoute } from "@/lib/service/routes"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

/**
 * Public-friendly "quotes" URL; estimates are the internal data model for quotes (no API rename in this phase).
 */
export default async function ServiceQuotesAliasPage({ searchParams }: Props) {
  const p = await searchParams
  const bid = p.business_id?.trim() ?? ""
  redirect(buildServiceRoute("/service/estimates", bid || undefined))
}
