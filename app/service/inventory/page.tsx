import { redirect } from "next/navigation"

/**
 * /service/inventory has been merged into /service/materials.
 * The materials page now shows quantity, last movement, and stock status.
 */
export default function ServiceInventoryRedirect() {
  redirect("/service/materials")
}
