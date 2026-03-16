import { redirect } from "next/navigation"

export default async function StockHistoryRedirect({
  params,
}: {
  params: Promise<{ productId: string }>
}) {
  const { productId } = await params
  redirect(`/retail/inventory/stock-history/${productId}`)
}
