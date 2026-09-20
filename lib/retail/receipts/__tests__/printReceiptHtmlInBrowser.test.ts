/**
 * @jest-environment jsdom
 */

import {
  printReceiptHtmlInBrowser,
  waitForReceiptImages,
  __resetRetailBrowserPrintGuardForTests,
  removeStalePrintFrames,
} from "../printReceiptHtmlInBrowser"

function sampleHtml(opts?: { logo?: boolean; qr?: boolean }): string {
  const logo = opts?.logo
    ? `<img src="https://example.com/logo.png" alt="" class="receipt-header-logo" />`
    : ""
  const qr = opts?.qr
    ? `<img src="data:image/png;base64,aaaa" alt="QR" class="qr" />`
    : ""
  return `<!DOCTYPE html><html><head><title>Receipt</title></head><body>
    <div class="receipt">${logo}<div>Test Shop</div>${qr}</div>
  </body></html>`
}

function stubIframePrint(opts?: { afterPrintDelayMs?: number }) {
  const delay = opts?.afterPrintDelayMs ?? 5
  const printSpy = jest.fn()
  const fakeDoc = document.implementation.createHTMLDocument("print")
  Object.defineProperty(fakeDoc, "readyState", { configurable: true, get: () => "complete" })
  // Avoid hanging on jsdom FontFaceSet.ready
  Object.defineProperty(fakeDoc, "fonts", {
    configurable: true,
    value: { status: "loaded", ready: Promise.resolve() },
  })

  const fakeWin = {
    focus: jest.fn(),
    print: printSpy,
    addEventListener: jest.fn((type: string, handler: EventListener) => {
      if (type === "afterprint") {
        setTimeout(() => handler(new Event("afterprint")), delay)
      }
    }),
    removeEventListener: jest.fn(),
    document: fakeDoc,
  } as unknown as Window

  const iframeProto = HTMLIFrameElement.prototype
  const prevDoc = Object.getOwnPropertyDescriptor(iframeProto, "contentDocument")
  const prevWin = Object.getOwnPropertyDescriptor(iframeProto, "contentWindow")

  Object.defineProperty(iframeProto, "contentDocument", {
    configurable: true,
    get() {
      return fakeDoc
    },
  })
  Object.defineProperty(iframeProto, "contentWindow", {
    configurable: true,
    get() {
      return fakeWin
    },
  })

  const writeSpy = jest.spyOn(fakeDoc, "write")

  return {
    printSpy,
    writeSpy,
    fakeDoc,
    restore() {
      writeSpy.mockRestore()
      if (prevDoc) Object.defineProperty(iframeProto, "contentDocument", prevDoc)
      if (prevWin) Object.defineProperty(iframeProto, "contentWindow", prevWin)
    },
  }
}

describe("printReceiptHtmlInBrowser", () => {
  beforeEach(() => {
    __resetRetailBrowserPrintGuardForTests()
    document.body.innerHTML = ""
  })

  afterEach(() => {
    removeStalePrintFrames()
    __resetRetailBrowserPrintGuardForTests()
  })

  it("does not call window.open on the preferred iframe path", async () => {
    const openSpy = jest.spyOn(window, "open")
    const stub = stubIframePrint()
    try {
      const result = await printReceiptHtmlInBrowser(sampleHtml({ qr: true }))
      expect(result).toEqual({ ok: true })
      expect(openSpy).not.toHaveBeenCalled()
      expect(stub.writeSpy).toHaveBeenCalled()
      expect(stub.printSpy).toHaveBeenCalledTimes(1)
      expect(document.querySelectorAll("iframe[data-finza-receipt-print-frame]").length).toBe(0)
    } finally {
      openSpy.mockRestore()
      stub.restore()
    }
  })

  it("blocks duplicate concurrent print jobs", async () => {
    const stub = stubIframePrint({ afterPrintDelayMs: 80 })
    try {
      const first = printReceiptHtmlInBrowser(sampleHtml())
      // Allow write/prepare microtasks to start before second call
      await new Promise((r) => setTimeout(r, 10))
      const second = await printReceiptHtmlInBrowser(sampleHtml())
      expect(second.ok).toBe(false)
      if (!second.ok) expect(second.message).toMatch(/already in progress/i)
      await first
      expect(stub.printSpy).toHaveBeenCalledTimes(1)
    } finally {
      stub.restore()
    }
  })

  it("cleans up the iframe after afterprint (cancel or print)", async () => {
    const stub = stubIframePrint({ afterPrintDelayMs: 15 })
    try {
      const p = printReceiptHtmlInBrowser(sampleHtml())
      await new Promise((r) => setTimeout(r, 5))
      expect(document.querySelectorAll("iframe[data-finza-receipt-print-frame]").length).toBe(1)
      await p
      expect(document.querySelectorAll("iframe[data-finza-receipt-print-frame]").length).toBe(0)
    } finally {
      stub.restore()
    }
  })

  it("rejects empty HTML", async () => {
    const res = await printReceiptHtmlInBrowser("   ")
    expect(res.ok).toBe(false)
  })

  it("calls print exactly once per successful job", async () => {
    const stub = stubIframePrint()
    try {
      await printReceiptHtmlInBrowser(sampleHtml())
      expect(stub.printSpy).toHaveBeenCalledTimes(1)
    } finally {
      stub.restore()
    }
  })
})

describe("waitForReceiptImages", () => {
  it("resolves when images are already complete", async () => {
    const doc = document.implementation.createHTMLDocument("t")
    const img = doc.createElement("img")
    Object.defineProperty(img, "complete", { get: () => true })
    doc.body.appendChild(img)
    await expect(waitForReceiptImages(doc, 100)).resolves.toBeUndefined()
  })

  it("resolves on image error without hanging (logo failure fallback)", async () => {
    const doc = document.implementation.createHTMLDocument("t")
    const img = doc.createElement("img")
    Object.defineProperty(img, "complete", { get: () => false })
    doc.body.appendChild(img)
    const wait = waitForReceiptImages(doc, 2000)
    img.dispatchEvent(new Event("error"))
    await expect(wait).resolves.toBeUndefined()
  })
})
