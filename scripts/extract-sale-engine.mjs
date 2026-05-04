import fs from "fs"

const src = fs.readFileSync("app/api/sales/create/route.ts", "utf8")
const lines = src.split("\n")

const take = (start, end) => lines.slice(start, end).join("\n")

// Lines 1-22: imports — drop NextRequest path-only if present, we'll rebuild header
const importBlock = take(0, 22)
  .replace(`import { NextRequest, NextResponse } from "next/server"\n`, `import { NextResponse } from "next/server"\n`)
  .replace(`import { createSupabaseServerClient } from "@/lib/supabaseServer"\n`, "")
  .replace(`import { getCurrentBusiness } from "@/lib/business"\n`, "")

const helpersAndClient = take(22, 154) // const supabase through PaymentLine type — ends before export async function POST

const bodyDestructure = take(180, 219) // const { ... } = body

const engineTail = take(223, 2157) // from const retailMomoRef through return success; ends before } catch of POST

const header = `${importBlock}
import "server-only"

${helpersAndClient}

export type RetailSaleCreationAuth =
  | { mode: "session"; businessId: string; userId: string }
  | { mode: "token"; businessId: string; userId: string; storeId: string }

/**
 * Shared retail sale creation (ledger, stock, reconciliation).
 */
export async function runRetailSaleCreationEngine(
  body: Record<string, unknown>,
  auth: RetailSaleCreationAuth,
  isOfflineSync: boolean
): Promise<NextResponse> {
  const supabase = supabase

  try {
    ${bodyDestructure.replace("= body", "= body as any")}

    const business_id = auth.businessId
    const user_id = auth.userId

`

// Fix duplicate const supabase = supabase — helpers already has `const supabase = createClient`
const engineCore = `${header}${engineTail}
  } catch (error: any) {
    console.error("Error in runRetailSaleCreationEngine:", error)
    console.error("Error stack:", error.stack)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
`

// Remove wrong line `const supabase = supabase`
const fixed = engineCore.replace(
  /const supabase = supabase\n\n  try \{/,
  `  try {`
).replace(
  /const supabase = createClient\(/,
  `const supabaseEngine = createClient(`
).replace(
  /\nexport async function runRetailSaleCreationEngine[\s\S]*?const supabase = supabaseEngine\n\n  try \{/,
  (m) => m.replace("const supabase = supabaseEngine\n\n  try {", "  try {\n    const supabase = supabaseEngine\n")
)

// Actually the helpers use `const supabase = createClient` - we renamed to supabaseEngine in first replace only once - need cleaner approach

let out = `${importBlock}
import "server-only"

${helpersAndClient.replace("const supabase = createClient", "const supabaseEngine = createClient")}

export type RetailSaleCreationAuth =
  | { mode: "session"; businessId: string; userId: string }
  | { mode: "token"; businessId: string; userId: string; storeId: string }

export async function runRetailSaleCreationEngine(
  body: Record<string, unknown>,
  auth: RetailSaleCreationAuth,
  isOfflineSync: boolean
): Promise<NextResponse> {
  const supabase = supabaseEngine
  try {
    ${bodyDestructure.replace("= body", "= body as any")}

    const business_id = auth.businessId
    const user_id = auth.userId

${engineTail}
  } catch (error: any) {
    console.error("Error in runRetailSaleCreationEngine:", error)
    console.error("Error stack:", error.stack)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
`

fs.writeFileSync("lib/sales/runRetailSaleCreationEngine.server.ts", out)
console.log("Wrote engine", out.split("\n").length, "lines")
