import { redirect } from "next/navigation"

/** Alias for the password recovery form (`/auth/reset-password`). */
export default function UpdatePasswordAliasPage() {
  redirect("/auth/reset-password")
}
