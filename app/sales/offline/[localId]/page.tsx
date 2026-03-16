import { redirect } from "next/navigation"

export default async function SalesOfflineReceiptRoot({
  params,
}: {
  params: Promise<{ localId: string }>
}) {
  const { localId } = await params
  redirect(`/retail/sales/offline/${localId}`)
}
