import { redirect } from "next/navigation"
import { controlTowerListRedirectPath } from "@/lib/practice/work/compat"

export default async function ControlTowerCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<{ business_id?: string | string[] }>
}) {
  const params = await searchParams
  redirect(controlTowerListRedirectPath(params))
}
