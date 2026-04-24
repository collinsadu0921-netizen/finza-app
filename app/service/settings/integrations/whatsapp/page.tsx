import { redirect } from "next/navigation"
import { buildServiceRoute } from "@/lib/service/routes"

type Props = {
  searchParams: Promise<{ business_id?: string }>
}

/** Legacy path; canonical Service editor is under /service/settings/communication/whatsapp. */
export default async function ServiceWhatsAppIntegrationLegacyRedirectPage({ searchParams }: Props) {
  const p = await searchParams
  const bid = p.business_id?.trim() ?? ""
  redirect(buildServiceRoute("/service/settings/communication/whatsapp", bid || undefined))
}
