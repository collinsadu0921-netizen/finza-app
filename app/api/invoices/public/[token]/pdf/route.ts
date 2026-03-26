import { NextRequest, NextResponse } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const token = encodeURIComponent((resolvedParams.token || "").trim())
    if (!token) {
      return NextResponse.json({ error: "Public token is required" }, { status: 400 })
    }

    // Public invoice page already supports print-to-PDF and works without auth.
    return NextResponse.redirect(new URL(`/invoice-public/${token}`, request.url))
  } catch (error: any) {
    console.error("Error generating public invoice PDF:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

