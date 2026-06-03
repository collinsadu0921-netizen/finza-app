import {
  appHrefNeedsUpdate,
  normalizeAppHref,
  replaceIfChanged,
} from "@/lib/navigation/safeReplace"

const PATH = "/service/expenses/create"

describe("normalizeAppHref", () => {
  it("sorts query keys for stable comparison", () => {
    expect(normalizeAppHref(PATH, "business_id=a&page=2")).toBe(
      normalizeAppHref(PATH, "page=2&business_id=a")
    )
  })
})

describe("appHrefNeedsUpdate", () => {
  it("returns false when target equals current URL", () => {
    const search = "business_id=biz-x&page=2"
    const target = `${PATH}?page=2&business_id=biz-x`
    expect(appHrefNeedsUpdate(PATH, search, target)).toBe(false)
  })

  it("returns true when business_id is missing", () => {
    expect(
      appHrefNeedsUpdate(PATH, "", `${PATH}?business_id=biz-x`)
    ).toBe(true)
  })
})

describe("replaceIfChanged", () => {
  it("does not call router.replace when URL already matches", () => {
    const replace = jest.fn()
    const router = { replace } as unknown as Parameters<typeof replaceIfChanged>[0]
    const search = "business_id=biz-x"
    const target = `${PATH}?business_id=biz-x`

    const changed = replaceIfChanged(router, PATH, search, target)

    expect(changed).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it("calls router.replace once when URL differs", () => {
    const replace = jest.fn()
    const router = { replace } as unknown as Parameters<typeof replaceIfChanged>[0]
    const target = `${PATH}?business_id=biz-x`

    const changed = replaceIfChanged(router, PATH, "", target)

    expect(changed).toBe(true)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(target, { scroll: false })
  })
})
