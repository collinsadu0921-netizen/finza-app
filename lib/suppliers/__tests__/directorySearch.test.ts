import { describe, expect, it } from "@jest/globals"
import { supplierMatchesDirectorySearch } from "../directorySearch"

const SUPPLIER = { name: "Supplier A", phone: "0201111222", email: "a@t.test" }

describe("supplierMatchesDirectorySearch", () => {
  it("matches name", () => {
    expect(supplierMatchesDirectorySearch(SUPPLIER, "supplier a")).toBe(true)
  })

  it("matches phone", () => {
    expect(supplierMatchesDirectorySearch(SUPPLIER, "0201")).toBe(true)
  })

  it("matches email", () => {
    expect(supplierMatchesDirectorySearch(SUPPLIER, "a@t")).toBe(true)
  })

  it("returns false when nothing matches", () => {
    expect(supplierMatchesDirectorySearch(SUPPLIER, "palace")).toBe(false)
  })

  it("treats empty search as a match", () => {
    expect(supplierMatchesDirectorySearch(SUPPLIER, "  ")).toBe(true)
  })
})
