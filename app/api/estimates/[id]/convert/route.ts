import { NextRequest, NextResponse } from "next/server"

/** @deprecated Clients must use POST /api/estimates/convert/[id] with JSON body `{ business_id }`. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated. Use POST /api/estimates/convert/:id with JSON body { \"business_id\": \"<uuid>\" }.",
    },
    { status: 410 }
  )
}
