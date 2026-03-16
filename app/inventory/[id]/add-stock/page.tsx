import { redirect } from "next/navigation"

export default async function AddStockRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const q = await searchParams
  const variantId = typeof q.variant_id === "string" ? q.variant_id : undefined
  const variantName = typeof q.variant_name === "string" ? q.variant_name : undefined
  const base = `/retail/inventory/${id}/add-stock`
  const search = new URLSearchParams()
  if (variantId) search.set("variant_id", variantId)
  if (variantName) search.set("variant_name", variantName)
  const query = search.toString()
  redirect(query ? `${base}?${query}` : base)
}
