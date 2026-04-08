import type { NextRequest } from "next/server"

/** Callback URLs must use the public origin, not localhost in production. */
export function resolvePublicAppOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")

  const origin = request.nextUrl?.origin
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/$/, "")
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel}`.replace(/\/$/, "")

  return "http://localhost:3000"
}
