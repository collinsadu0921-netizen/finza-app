import { redirect } from "next/navigation"

export default async function ControlTowerClientPage({
  params,
}: {
  params: Promise<{ businessId: string }>
}) {
  const { businessId } = await params
  redirect(`/accounting/clients/${businessId}/overview`)
}
