import { describe, expect, it } from "@jest/globals"
import {
  DEFAULT_PROPOSAL_TEMPLATE_ID,
  LEGACY_PROPOSAL_TEMPLATE_ID,
  PROPOSAL_TEMPLATE_IDS,
  PROPOSAL_TEMPLATE_META,
  defaultSectionsForTemplate,
  getProposalTemplateMeta,
  isKnownTemplateId,
  normalizeTemplateId,
} from "../templates"
import { getProposalTheme, normalizeAccentColor, normalizeTypography } from "../design"

describe("proposal templates", () => {
  it("exposes three new designs plus the legacy template", () => {
    expect(PROPOSAL_TEMPLATE_IDS).toEqual([
      LEGACY_PROPOSAL_TEMPLATE_ID,
      "minimal_v1",
      "modern_v1",
      "premium_v1",
    ])
    expect(DEFAULT_PROPOSAL_TEMPLATE_ID).toBe("premium_v1")
    expect(PROPOSAL_TEMPLATE_META.filter((template) => !template.legacy).map((template) => template.label)).toEqual([
      "Minimal",
      "Modern",
      "Premium",
    ])
  })

  it("keeps standard_v1 valid and preserves its original starter sections", () => {
    expect(isKnownTemplateId("standard_v1")).toBe(true)
    expect(normalizeTemplateId("standard_v1")).toBe("standard_v1")
    expect(normalizeTemplateId("unknown_v9")).toBe(DEFAULT_PROPOSAL_TEMPLATE_ID)
    expect(getProposalTemplateMeta("standard_v1").legacy).toBe(true)

    const sections = defaultSectionsForTemplate("standard_v1")
    expect(sections.some((section) => section.type === "heading" && section.text === "Scope")).toBe(true)
    expect(sections.some((section) => section.type === "heading" && section.text === "Timeline")).toBe(true)
  })

  it("creates a chapter-oriented starter sequence without fabricated prices or claims", () => {
    const sections = defaultSectionsForTemplate("premium_v1")
    const headings = sections
      .filter((section): section is Extract<typeof section, { type: "heading" }> => section.type === "heading")
      .map((section) => section.text)
    expect(headings).toEqual(
      expect.arrayContaining([
        "Introduction",
        "About the company",
        "Client needs and project overview",
        "Proposed solution",
        "Scope of work",
        "Deliverables",
        "Timeline and milestones",
        "Portfolio",
        "Investment and pricing",
        "Terms and conditions",
        "Acceptance",
      ])
    )
    expect(JSON.stringify(sections)).not.toMatch(/GHS\s?\d|\$\s?\d|€\s?\d|£\s?\d/)
    expect(JSON.stringify(sections)).not.toMatch(/testimonial|award-winning|best in/i)
  })
})

describe("proposal design tokens", () => {
  it("gives each new template a distinct visual identity", () => {
    const minimal = getProposalTheme("minimal_v1")
    const modern = getProposalTheme("modern_v1")
    const premium = getProposalTheme("premium_v1")
    expect(new Set([minimal.accent, modern.accent, premium.accent]).size).toBe(3)
    expect(new Set([minimal.coverBg, modern.coverBg, premium.coverBg]).size).toBeGreaterThan(1)
    expect(minimal.coverStyle).toBe("minimal")
    expect(modern.coverStyle).toBe("modern")
    expect(premium.coverStyle).toBe("premium")
  })

  it("applies a safe accent override and typography selection", () => {
    const theme = getProposalTheme("modern_v1", { accentColor: "#123abc", typography: "serif" })
    expect(theme.accent).toBe("#123abc")
    expect(theme.headingFont).toContain("Georgia")
    expect(normalizeAccentColor("not-a-colour", "#000000")).toBe("#000000")
    expect(normalizeTypography("editorial")).toBe("editorial")
    expect(normalizeTypography("nonsense")).toBe("sans")
  })
})
