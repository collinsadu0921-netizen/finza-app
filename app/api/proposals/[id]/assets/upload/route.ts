import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Legacy multipart upload endpoint. Vercel Functions cap request bodies at
 * 4.5 MB, so this route cannot safely support the 15 MB proposal-asset limit.
 * Clients must use the signed direct-to-Storage flow:
 *
 *   POST /api/proposals/[id]/assets/upload-intent
 *   PUT  <signed Storage upload URL>
 *   POST /api/proposals/[id]/assets/finalize
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Direct-to-storage upload required.",
      code: "DIRECT_UPLOAD_REQUIRED",
      upload_intent: "/api/proposals/[id]/assets/upload-intent",
    },
    { status: 410 }
  )
}
