import { redirect } from "next/navigation"

export default async function PurchaseOrderDetailRoot({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/retail/admin/purchase-orders/${id}`)
}
