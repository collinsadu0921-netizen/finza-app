import { createBrowserClient } from "@supabase/ssr"

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (typeof window !== "undefined" && anonKey) {
  try {
    const payload = JSON.parse(atob(anonKey.split(".")[1] ?? ""))
    if (payload?.role === "service_role") {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY is set to the service_role (secret) key. " +
          "Use the anon/public key from Supabase Dashboard → Project Settings → API instead. " +
          "The service_role key must never be used in the browser."
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY")) throw e
  }
}

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey!
)






















