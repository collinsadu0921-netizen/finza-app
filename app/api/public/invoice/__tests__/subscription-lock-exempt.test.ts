/**
 * Public invoice API must stay exempt from service subscription lock guards.
 */

import { describe, it, expect } from "@jest/globals"
import * as fs from "node:fs"
import * as path from "node:path"

describe("public invoice API", () => {
  it("does not import enforceServiceWorkspaceAccess", () => {
    const routePath = path.join(__dirname, "..", "[id]", "route.ts")
    const src = fs.readFileSync(routePath, "utf8")
    expect(src).not.toMatch(/enforceServiceWorkspaceAccess/)
  })
})
