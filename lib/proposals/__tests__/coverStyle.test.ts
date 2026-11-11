import {
  contrastRatio,
  normalizeCoverColor,
  normalizeCoverImagePosition,
  proposalCoverCssVariables,
  readableCoverInk,
  resolveProposalCoverStyle,
} from "../coverStyle"

describe("proposal cover colour validation", () => {
  it("accepts only six-digit HEX values", () => {
    expect(normalizeCoverColor("#1D4ED8")).toBe("#1d4ed8")
    expect(normalizeCoverColor(" #0b1f3a ")).toBe("#0b1f3a")
    expect(normalizeCoverColor("#fff")).toBeNull()
    expect(normalizeCoverColor("#1d4ed8ff")).toBeNull()
    expect(normalizeCoverColor("rgb(29 78 216)")).toBeNull()
    expect(normalizeCoverColor("url(javascript:alert(1))")).toBeNull()
    expect(normalizeCoverColor("expression(alert(1))")).toBeNull()
  })

  it("accepts only supported cover image positions", () => {
    expect(normalizeCoverImagePosition("top")).toBe("top")
    expect(normalizeCoverImagePosition("bottom")).toBe("bottom")
    expect(normalizeCoverImagePosition("top left")).toBeNull()
    expect(normalizeCoverImagePosition("url(x)")).toBeNull()
  })
})

describe("readable cover contrast", () => {
  it("uses white ink on navy and dark ink on cream", () => {
    const navy = readableCoverInk("#0b1f3a")
    expect(navy.ink).toBe("#ffffff")
    expect(navy.ratio).toBeGreaterThan(4.5)
    expect(navy.needsScrim).toBe(false)

    const cream = readableCoverInk("#fbf8f2")
    expect(cream.ink).toBe("#111827")
    expect(cream.ratio).toBeGreaterThan(4.5)
    expect(cream.needsScrim).toBe(false)
  })

  it("selects the better ink and flags mid-tone colours that need a scrim", () => {
    const mid = readableCoverInk("#787878")
    expect([ "#111827", "#ffffff" ]).toContain(mid.ink)
    expect(mid.needsScrim).toBe(true)
    expect(contrastRatio("#787878", mid.ink)).toBeCloseTo(mid.ratio, 5)
  })
})

describe("resolveProposalCoverStyle", () => {
  it("keeps the template default when no proposal customisation exists", () => {
    const premium = resolveProposalCoverStyle({ templateId: "premium_v1" })
    expect(premium.isCustom).toBe(false)
    expect(premium.backgroundColor).toBe("#1c1917")
    expect(premium.ink).toBe("#faf7f2")
    expect(premium.overlay).toBe("")
    expect(premium.imagePosition).toBe("center")
  })

  it("keeps template identity for navy and royal-blue Premium covers", () => {
    const navy = resolveProposalCoverStyle({ templateId: "premium_v1", backgroundColor: "#0b1f3a" })
    const royal = resolveProposalCoverStyle({ templateId: "premium_v1", backgroundColor: "#1d4ed8" })
    expect(navy.isCustom).toBe(true)
    expect(royal.isCustom).toBe(true)
    expect(navy.coverStyle).toBe("premium")
    expect(royal.coverStyle).toBe("premium")
    expect(navy.ink).toBe("#ffffff")
    expect(royal.ink).toBe("#ffffff")
    expect(navy.overlay).toContain("radial-gradient")
    expect(royal.overlay).toContain("radial-gradient")
  })

  it("supports light custom backgrounds with dark text", () => {
    const light = resolveProposalCoverStyle({ templateId: "minimal_v1", backgroundColor: "#fbf8f2" })
    expect(light.isCustom).toBe(true)
    expect(light.ink).toBe("#111827")
    expect(light.isLightBackground).toBe(true)
    expect(proposalCoverCssVariables(light)["--pp-cover-bg"]).toBe("#fbf8f2")
    expect(proposalCoverCssVariables(light)["--pp-cover-ink"]).toBe("#111827")
  })

  it("uses a strong readable overlay and image position for cover photographs", () => {
    const image = resolveProposalCoverStyle({
      templateId: "modern_v1",
      backgroundColor: "#1d4ed8",
      imagePosition: "top",
      hasImage: true,
    })
    expect(image.isCustom).toBe(true)
    expect(image.ink).toBe("#ffffff")
    expect(image.imagePosition).toBe("top")
    expect(image.overlay).toContain("rgba(0,0,0,0.68)")
    expect(proposalCoverCssVariables(image)["--pp-cover-overlay"]).toContain("linear-gradient")
  })

  it("does not apply an image position without an image", () => {
    const noImage = resolveProposalCoverStyle({
      templateId: "minimal_v1",
      imagePosition: "bottom",
    })
    expect(noImage.isCustom).toBe(false)
    expect(noImage.imagePosition).toBe("center")
  })
})
