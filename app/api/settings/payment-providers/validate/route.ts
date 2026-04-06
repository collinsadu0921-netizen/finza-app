import { NextResponse } from "next/server"

/** Conservative stub: live provider verification is not implemented in Phase 3. */
export async function POST() {
  return NextResponse.json(
    { error: "validation_not_implemented", message: "Provider validation is not available yet." },
    { status: 501 }
  )
}
