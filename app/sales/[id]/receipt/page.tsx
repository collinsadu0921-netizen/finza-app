import { redirect } from "next/navigation"

export default async function SalesReceiptRoot({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/retail/sales/${id}/receipt`)
}
