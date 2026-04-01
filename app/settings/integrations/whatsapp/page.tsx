import { redirect } from "next/navigation"

/** WhatsApp Cloud API UI removed; sending uses wa.me links and email. */
export default function WhatsAppIntegrationRedirectPage() {
  redirect("/service/settings")
}
