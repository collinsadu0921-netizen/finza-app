import { NextResponse } from "next/server"

/** Debug stock dump. Not reachable. */
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
