import { redirect } from "next/navigation"

export default function ControlTowerClientPage({
  params,
}: {
  params: { businessId: string }
}) {
  redirect(`/accounting/clients/${params.businessId}/overview`)
}
