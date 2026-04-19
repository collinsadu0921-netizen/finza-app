import { redirect } from "next/navigation"

export default async function SalesReceiptRoot({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === "string") q.set(key, val)
    else if (Array.isArray(val)) val.forEach((v) => q.append(key, v))
  }
  const suffix = q.toString() ? `?${q.toString()}` : ""
  redirect(`/retail/sales/${id}/receipt${suffix}`)
}
