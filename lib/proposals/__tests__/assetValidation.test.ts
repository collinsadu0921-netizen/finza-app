import sharp from "sharp"
import {
  ProposalAssetValidationError,
  detectProposalAssetMime,
  validateProposalAssetContent,
} from "../assetValidation"

jest.mock("pdf-parse", () => jest.fn(async () => ({ numpages: 1 })))

async function imageBuffer(format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  const pipeline = sharp({
    create: { width: 24, height: 16, channels: 3, background: { r: 20, g: 120, b: 80 } },
  })
  if (format === "jpeg") return pipeline.jpeg().toBuffer()
  if (format === "png") return pipeline.png().toBuffer()
  return pipeline.webp().toBuffer()
}

describe("proposal asset content validation", () => {
  it("decodes and re-encodes a valid JPEG", async () => {
    const result = await validateProposalAssetContent({
      buffer: await imageBuffer("jpeg"),
      declaredMime: "image/jpeg",
    })
    expect(result.mimeType).toBe("image/jpeg")
    expect(result.extension).toBe("jpg")
    expect(result.rewritten).toBe(true)
    expect(result.width).toBe(24)
    expect(result.height).toBe(16)
    expect(result.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it("rejects HTML disguised as JPEG", async () => {
    await expect(
      validateProposalAssetContent({
        buffer: Buffer.from("<html><script>alert(1)</script></html>"),
        declaredMime: "image/jpeg",
      })
    ).rejects.toBeInstanceOf(ProposalAssetValidationError)
  })

  it("rejects a PNG whose declared type is JPEG", async () => {
    await expect(
      validateProposalAssetContent({
        buffer: await imageBuffer("png"),
        declaredMime: "image/jpeg",
      })
    ).rejects.toThrow("does not match")
  })

  it("rejects a truncated image", async () => {
    const full = await imageBuffer("jpeg")
    await expect(
      validateProposalAssetContent({
        buffer: full.subarray(0, 5),
        declaredMime: "image/jpeg",
      })
    ).rejects.toBeInstanceOf(ProposalAssetValidationError)
  })

  it("rejects unsupported and active content MIME types", async () => {
    await expect(
      validateProposalAssetContent({
        buffer: Buffer.from("<svg><script>alert(1)</script></svg>"),
        declaredMime: "image/svg+xml",
      })
    ).rejects.toThrow("Unsupported file type")
  })

  it("accepts a PDF with a header and EOF marker after parsing", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1")
    const result = await validateProposalAssetContent({ buffer: pdf, declaredMime: "application/pdf" })
    expect(result.mimeType).toBe("application/pdf")
    expect(result.rewritten).toBe(false)
  })

  it("rejects a truncated PDF", async () => {
    await expect(
      validateProposalAssetContent({
        buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\n", "latin1"),
        declaredMime: "application/pdf",
      })
    ).rejects.toThrow("malformed or truncated")
  })

  it("detects safe MIME signatures and rejects HTML", async () => {
    expect(detectProposalAssetMime(await imageBuffer("jpeg"))).toBe("image/jpeg")
    expect(detectProposalAssetMime(await imageBuffer("png"))).toBe("image/png")
    expect(detectProposalAssetMime(await imageBuffer("webp"))).toBe("image/webp")
    expect(detectProposalAssetMime(Buffer.from("<html></html>"))).toBeNull()
  })
})
