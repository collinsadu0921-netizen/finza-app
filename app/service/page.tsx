import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/** Catalog lives under `/service/services` and `/service/materials`; this URL is legacy. */
export default function ServiceRootRedirect() {
  redirect("/service/services")
}
