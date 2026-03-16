import { redirect } from "next/navigation"

export default async function SalesHistoryDetailRoot({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/retail/sales-history/${id}`)
}
