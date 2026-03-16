import { NextRequest } from "next/server"

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return new Response("hit")
}
