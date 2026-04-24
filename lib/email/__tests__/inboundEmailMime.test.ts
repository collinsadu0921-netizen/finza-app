import { describe, it, expect } from "@jest/globals"
import {
  inferMimeFromFileName,
  isSupportedInboundAttachmentMime,
  normalizeMime,
} from "@/lib/email/inboundEmailMime"

describe("inboundEmailMime", () => {
  it("detects supported types by mime or filename", () => {
    expect(isSupportedInboundAttachmentMime("application/pdf", null)).toBe(true)
    expect(isSupportedInboundAttachmentMime("image/jpeg", null)).toBe(true)
    expect(isSupportedInboundAttachmentMime("image/jpg", null)).toBe(true)
    expect(isSupportedInboundAttachmentMime("image/png", null)).toBe(true)
    expect(isSupportedInboundAttachmentMime("image/webp", null)).toBe(true)
    expect(isSupportedInboundAttachmentMime(null, "scan.JPEG")).toBe(true)
    expect(isSupportedInboundAttachmentMime(null, "doc.PDF")).toBe(true)
    expect(isSupportedInboundAttachmentMime("application/zip", "x.zip")).toBe(false)
    expect(isSupportedInboundAttachmentMime("text/plain", null)).toBe(false)
  })

  it("normalizes mime parameters", () => {
    expect(normalizeMime("Image/PNG; charset=binary")).toBe("image/png")
  })

  it("infers mime from extension", () => {
    expect(inferMimeFromFileName("folder/receipt.webp")).toBe("image/webp")
  })
})
