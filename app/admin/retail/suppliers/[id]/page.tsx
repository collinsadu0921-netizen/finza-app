import { redirect } from "next/navigation"

export default async function SupplierDetailRoot({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/retail/admin/suppliers/${id}`)
}
