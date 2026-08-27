import { describe, expect, it } from "@jest/globals"
import { duplicateNameWarning, findExactNameDuplicates } from "../duplicateName"

const MELCOM = { id: "s1", name: "Melcom" }
const OTHER = { id: "s2", name: "Palace" }

describe("findExactNameDuplicates", () => {
  it("finds a case-insensitive exact name match in the same list", () => {
    expect(findExactNameDuplicates("melcom", [MELCOM, OTHER])).toEqual([MELCOM])
  })

  it("does not match a different name", () => {
    expect(findExactNameDuplicates("Melcom Ltd", [MELCOM])).toEqual([])
  })

  it("can exclude the current supplier when editing", () => {
    expect(findExactNameDuplicates("Melcom", [MELCOM, OTHER], MELCOM.id)).toEqual([])
  })
})

describe("duplicateNameWarning", () => {
  it("names the existing supplier", () => {
    expect(duplicateNameWarning("Melcom")).toBe("A supplier named Melcom already exists.")
  })
})
