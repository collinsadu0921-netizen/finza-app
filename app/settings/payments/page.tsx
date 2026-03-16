import { redirect } from "next/navigation"

export default function PaymentSettingsRedirect() {
  redirect("/service/settings/payments")
}
