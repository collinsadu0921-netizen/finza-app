const nextConfig = require("../../../next.config.js")

describe("pdfkit Vercel bundling config", () => {
  it("does not externalize pdfkit so standalone can bundle embedded fonts", () => {
    expect(nextConfig.serverExternalPackages ?? []).not.toContain("pdfkit")
  })
})
