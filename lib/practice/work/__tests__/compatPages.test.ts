import { existsSync } from "fs"
import path from "path"
import { controlTowerListRedirectPath } from "../compat"

const root = process.cwd()

describe("source pages remain available", () => {
  it("keeps Tasks, Requests, and Filings routes", () => {
    expect(existsSync(path.join(root, "app/accounting/tasks/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/accounting/requests/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/accounting/filings/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/accounting/clients/[id]/tasks/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/accounting/clients/[id]/requests/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/accounting/clients/[id]/filings/page.tsx"))).toBe(true)
  })

  it("keeps Control Tower client deep links and redirects the list", () => {
    expect(existsSync(path.join(root, "app/accounting/control-tower/[businessId]/page.tsx"))).toBe(true)
    expect(controlTowerListRedirectPath({ business_id: "biz-1" })).toBe("/accounting/work?client=biz-1")
  })
})
