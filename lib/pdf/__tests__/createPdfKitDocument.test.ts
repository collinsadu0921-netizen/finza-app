import { createPdfKitDocument } from "../createPdfKitDocument"

jest.mock("pdfkit/js/pdfkit.standalone.js", () => {
  const { EventEmitter } = require("events")
  return {
    __esModule: true,
    default: class MockPDFDocument extends EventEmitter {
      page = { width: 595, height: 842, margins: { left: 50 } }
      y = 100
      constructor() {
        super()
      }
      fontSize() {
        return this
      }
      font() {
        return this
      }
      text() {
        return this
      }
      moveDown() {
        return this
      }
      rect() {
        return this
      }
      stroke() {
        return this
      }
      fillAndStroke() {
        return this
      }
      addPage() {
        return this
      }
      on(event: string, handler: (...args: unknown[]) => void) {
        super.on(event, handler)
        return this
      }
      end() {
        setImmediate(() => {
          this.emit("data", Buffer.from("%PDF-mock"))
          this.emit("end")
        })
      }
    },
  }
})

describe("createPdfKitDocument", () => {
  it("loads the standalone pdfkit build with embedded fonts", async () => {
    const doc = await createPdfKitDocument({ margin: 50 })
    expect(doc).toBeDefined()
    expect(typeof doc.font).toBe("function")
  })
})
