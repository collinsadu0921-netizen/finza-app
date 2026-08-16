import { isServiceWorkspacePath } from "../routeWorkspace"

describe("isServiceWorkspacePath", () => {
  it("matches /service and /service/* paths", () => {
    expect(isServiceWorkspacePath("/service")).toBe(true)
    expect(isServiceWorkspacePath("/service/")).toBe(true)
    expect(isServiceWorkspacePath("/service/dashboard")).toBe(true)
    expect(isServiceWorkspacePath("/service/invoices")).toBe(true)
  })

  it("does not match retail, accounting, or shared billing paths", () => {
    expect(isServiceWorkspacePath("/retail/dashboard")).toBe(false)
    expect(isServiceWorkspacePath("/accounting")).toBe(false)
    expect(isServiceWorkspacePath("/invoices")).toBe(false)
    expect(isServiceWorkspacePath("/reports/vat")).toBe(false)
  })
})
