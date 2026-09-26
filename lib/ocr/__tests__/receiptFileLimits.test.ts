import { describe, expect, it } from "@jest/globals"
import { checkReceiptFile } from "../receiptFileLimits"

describe("checkReceiptFile", () => {
  it("accepts jpeg, png, and pdf", () => {
    expect(checkReceiptFile({ name: "a.jpg", type: "image/jpeg", size: 1000 }).ok).toBe(true)
    expect(checkReceiptFile({ name: "a.png", type: "image/png", size: 1000 }).ok).toBe(true)
    expect(checkReceiptFile({ name: "a.pdf", type: "application/pdf", size: 1000 }).ok).toBe(true)
  })

  it("rejects a fake extension that disagrees with the MIME type", () => {
    const result = checkReceiptFile({ name: "receipt.jpg", type: "application/pdf", size: 1000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("OCR_MIME_MISMATCH")
  })

  it("rejects unsupported types and oversized files", () => {
    const kind = checkReceiptFile({ name: "notes.txt", type: "text/plain", size: 100 })
    expect(kind.ok).toBe(false)
    const huge = checkReceiptFile({ name: "big.jpg", type: "image/jpeg", size: 9 * 1024 * 1024 })
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.code).toBe("OCR_FILE_TOO_LARGE")
  })
})
