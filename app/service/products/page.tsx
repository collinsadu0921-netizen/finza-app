import { redirect } from "next/navigation"
import { buildServiceRoute } from "@/lib/service/routes"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

/** Retail-style catalog lives under admin/retail; Service workspace uses Services + Materials. */
export default async function ServiceProductsRedirectPage({ searchParams }: Props) {
  const p = await searchParams
  const bid = p.business_id?.trim() ?? ""
  redirect(buildServiceRoute("/service/services", bid || undefined))
}
