import { redirect } from "next/navigation"

/** Catalog lives under `/service/services` and `/service/materials`; this URL is legacy. */
export default function ServiceRootRedirect() {
  redirect("/service/services")
}
