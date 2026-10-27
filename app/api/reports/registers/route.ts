import { NextResponse } from "next/server"

/**
 * GET /api/reports/registers
 *
 * This operational report is intentionally retired. Register reporting is
 * ledger-based and lives in the accounting workspace.
 */
export async function GET() {
  return NextResponse.json(
    {
      code: "LEDGER_READ_BLOCKED",
      error: "This report uses ledger data. Use accounting workspace reports.",
      canonical_alternative: "/api/accounting/reports/registers",
    },
    { status: 410 }
  )
}
