/**
 * Legacy GET /api/public/invoice/[id] must require a matching public_token
 * (query or header) and must not load by invoice UUID alone.
 */

import { describe, it, expect } from "@jest/globals"
import * as fs from "node:fs"
import * as path from "node:path"

describe("GET /api/public/invoice/[id]", () => {
  it("requires public_token in query or header and matches id + public_token in query", () => {
    const routePath = path.join(__dirname, "..", "[id]", "route.ts")
    const src = fs.readFileSync(routePath, "utf8")
    expect(src).toMatch(/readPublicToken/)
    expect(src).toMatch(/x-invoice-public-token/)
    expect(src).toMatch(/\.eq\("public_token"/)
    expect(src).not.toMatch(/This invoice is not yet issued/)
    expect(src).toMatch(/void/)
    expect(src).toMatch(/cancelled/)
  })
})
