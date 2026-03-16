import { redirect } from "next/navigation"

export default async function StoreSettingsRoot({
  params,
}: {
  params: Promise<{ storeId: string }>
}) {
  const { storeId } = await params
  redirect(`/retail/admin/store/${storeId}/settings`)
}
