import { createHash } from "crypto"
import fs from "fs"
import path from "path"
import { describe, expect, it } from "@jest/globals"

const root = path.join(__dirname, "..", "..", "..")

describe("vendored PaddleOCR worker", () => {
  it("matches the pinned @paddleocr/paddleocr-js 0.4.2 worker bundle", () => {
    const vendored = fs.readFileSync(path.join(root, "public/ocr/vendor/paddleocr/0.4.2/receipt-ocr-worker.js"))
    const packaged = fs.readFileSync(
      path.join(root, "node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js")
    )
    expect(createHash("sha256").update(vendored).digest("hex")).toBe(
      "477db3f009c118823a5f9ebe15f1e96c1c464165715ba28a9884290f61addf52"
    )
    expect(vendored.equals(packaged)).toBe(true)
  })
})
