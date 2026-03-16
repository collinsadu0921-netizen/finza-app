import { redirect } from "next/navigation"

export default async function StoreDetailRoot({
  params,
}: {
  params: Promise<{ storeId: string }>
}) {
  const { storeId } = await params
  redirect(`/retail/admin/store/${storeId}`)
}
