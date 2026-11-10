import {
  isProposalAssetStoragePath,
  proposalAssetExtensionForMime,
  proposalAssetStoragePath,
  sanitizeProposalAssetDisplayName,
} from "../storageConstants"

const BUSINESS = "42a2e6a3-7bb1-403b-b699-6a44dcc99d0f"
const PROPOSAL = "69cf467f-e4d3-481c-8a12-b72d443b2b1c"
const ASSET = "d796e0c8-f001-4eb4-a4e4-a74a0cda2d73"

describe("proposal storage constants", () => {
  it("generates a server-owned path without using the client filename", () => {
    expect(proposalAssetStoragePath(BUSINESS, PROPOSAL, ASSET, "jpg")).toBe(
      `${BUSINESS}/${PROPOSAL}/${ASSET}.jpg`
    )
    expect(proposalAssetStoragePath(BUSINESS, PROPOSAL, ASSET, "pdf")).not.toContain("invoice")
  })

  it("accepts only paths under the exact business/proposal prefix", () => {
    expect(
      isProposalAssetStoragePath(`${BUSINESS}/${PROPOSAL}/${ASSET}.webp`, BUSINESS, PROPOSAL)
    ).toBe(true)
    expect(
      isProposalAssetStoragePath(
        `4e6cdfba-e2ab-4ee4-ac00-9b077d696544/${PROPOSAL}/${ASSET}.jpg`,
        BUSINESS,
        PROPOSAL
      )
    ).toBe(false)
    expect(
      isProposalAssetStoragePath(`${BUSINESS}/${PROPOSAL}/../other/${ASSET}.jpg`, BUSINESS, PROPOSAL)
    ).toBe(false)
    expect(
      isProposalAssetStoragePath(`/${BUSINESS}/${PROPOSAL}/${ASSET}.jpg`, BUSINESS, PROPOSAL)
    ).toBe(false)
  })

  it("maps MIME types to canonical extensions", () => {
    expect(proposalAssetExtensionForMime("image/jpeg")).toBe("jpg")
    expect(proposalAssetExtensionForMime("image/png")).toBe("png")
    expect(proposalAssetExtensionForMime("image/webp")).toBe("webp")
    expect(proposalAssetExtensionForMime("application/pdf")).toBe("pdf")
    expect(() => proposalAssetExtensionForMime("text/html")).toThrow("Unsupported file type")
  })

  it("sanitises display filenames without using them for storage", () => {
    expect(sanitizeProposalAssetDisplayName("../../other-tenant/evil.jpg")).toBe("evil.jpg")
    expect(sanitizeProposalAssetDisplayName("  quarterly\u0000 report.pdf ")).toBe("quarterly report.pdf")
    expect(sanitizeProposalAssetDisplayName("")).toBe("file")
    expect(sanitizeProposalAssetDisplayName("a".repeat(300)).length).toBe(240)
  })
})
