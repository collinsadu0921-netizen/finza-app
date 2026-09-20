/**
 * Shared Retail browser-print helper.
 *
 * Preferred path: same-origin hidden iframe inside the current page so Chrome's
 * print-preview opens without a visible receipt tab/window (Linux PWA/app mode).
 * ESC/POS and receipt HTML content are unchanged — callers still pass finished HTML.
 *
 * Not silent/kiosk printing: Chrome print-preview remains required.
 */

export type PrintHtmlResult = { ok: true } | { ok: false; message: string }

const IFRAME_ATTR = "data-finza-receipt-print-frame"
const CLEANUP_FALLBACK_MS = 60_000
const ASSET_WAIT_MS = 8_000

let printInFlight = false

/** Test-only: reset the duplicate-print guard. */
export function __resetRetailBrowserPrintGuardForTests(): void {
  printInFlight = false
  removeStalePrintFrames()
}

export function removeStalePrintFrames(): void {
  if (typeof document === "undefined") return
  document.querySelectorAll(`iframe[${IFRAME_ATTR}]`).forEach((el) => {
    try {
      el.remove()
    } catch {
      /* ignore */
    }
  })
}

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForDocumentComplete(doc: Document): Promise<void> {
  if (doc.readyState === "complete" || doc.readyState === "interactive") {
    return Promise.resolve()
  }
  return Promise.race([
    new Promise<void>((resolve) => {
      const onReady = () => {
        if (doc.readyState === "complete" || doc.readyState === "interactive") {
          doc.removeEventListener("readystatechange", onReady)
          resolve()
        }
      }
      doc.addEventListener("readystatechange", onReady)
    }),
    // jsdom often never reaches "complete" after document.write — do not hang print.
    waitForTimeout(250),
  ])
}

async function waitForFonts(doc: Document): Promise<void> {
  try {
    const fonts = (doc as Document & { fonts?: FontFaceSet & { status?: string } }).fonts
    if (!fonts || typeof fonts.ready?.then !== "function") return
    if (fonts.status === "loaded") return
    // Cap wait — some environments expose fonts.ready that never settles.
    await Promise.race([fonts.ready, waitForTimeout(Math.min(ASSET_WAIT_MS, 1500))])
  } catch {
    /* font readiness is best-effort */
  }
}

/**
 * Wait for images to load or fail. Logo failure must not hang printing.
 * QR is normally a data URL and resolves immediately.
 */
export async function waitForReceiptImages(doc: Document, timeoutMs = ASSET_WAIT_MS): Promise<void> {
  const images = Array.from(doc.images || [])
  if (images.length === 0) return

  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            const src = typeof img.getAttribute === "function" ? img.getAttribute("src") || "" : ""
            // Data-URL QR (and similar) needs no network wait.
            if (src.startsWith("data:")) {
              resolve()
              return
            }
            if (img.complete) {
              resolve()
              return
            }
            const done = () => {
              img.removeEventListener("load", done)
              img.removeEventListener("error", done)
              resolve()
            }
            img.addEventListener("load", done)
            img.addEventListener("error", done)
          })
      )
    ),
    waitForTimeout(timeoutMs),
  ])
}

function waitForAfterPrint(win: Window): Promise<"afterprint" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (reason: "afterprint" | "timeout") => {
      if (settled) return
      settled = true
      try {
        win.removeEventListener("afterprint", onAfterPrint)
      } catch {
        /* ignore */
      }
      clearTimeout(timer)
      resolve(reason)
    }
    const onAfterPrint = () => finish("afterprint")
    win.addEventListener("afterprint", onAfterPrint)
    const timer = setTimeout(() => finish("timeout"), CLEANUP_FALLBACK_MS)
  })
}

function createHiddenPrintIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe")
  iframe.setAttribute(IFRAME_ATTR, "1")
  iframe.setAttribute("aria-hidden", "true")
  iframe.setAttribute("title", "Receipt print")
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;margin:0;padding:0;opacity:0;pointer-events:none;"
  document.body.appendChild(iframe)
  return iframe
}

async function writeAndPrepare(doc: Document, win: Window, html: string): Promise<void> {
  doc.open()
  doc.write(html)
  doc.close()
  await waitForDocumentComplete(doc)
  await waitForReceiptImages(doc)
  await waitForFonts(doc)
  // Brief layout settle after assets before Chrome captures the document.
  await waitForTimeout(50)
  void win
}

async function invokePrintAndCleanup(
  win: Window,
  cleanup: () => void
): Promise<PrintHtmlResult> {
  const afterPrintPromise = waitForAfterPrint(win)
  try {
    win.focus()
  } catch {
    /* focus is best-effort in PWA/app mode */
  }
  win.print()
  await afterPrintPromise
  cleanup()
  return { ok: true }
}

type HiddenIframeAttempt =
  | { status: "printed" }
  | { status: "unavailable" }
  | { status: "error"; message: string }

async function printViaHiddenIframe(html: string): Promise<HiddenIframeAttempt> {
  removeStalePrintFrames()
  const iframe = createHiddenPrintIframe()

  const cleanup = () => {
    try {
      iframe.remove()
    } catch {
      /* ignore */
    }
  }

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    cleanup()
    return { status: "unavailable" }
  }

  try {
    await writeAndPrepare(doc, win, html)
    const printed = await invokePrintAndCleanup(win, cleanup)
    if (!printed.ok) {
      return { status: "error", message: printed.message }
    }
    return { status: "printed" }
  } catch (e: unknown) {
    cleanup()
    return {
      status: "error",
      message: e instanceof Error ? e.message : "Failed to open the print dialog.",
    }
  }
}

/**
 * Fallback when the hidden iframe has no contentDocument. Opens a temporary
 * blank window, prints, and closes via afterprint + bounded timeout so no
 * abandoned receipt tab remains.
 */
async function printViaTemporaryWindow(html: string): Promise<PrintHtmlResult> {
  const printWindow = window.open("", "_blank")
  if (!printWindow) {
    return {
      ok: false,
      message: "Could not open the print dialog. Check browser print permissions and try again.",
    }
  }

  const cleanup = () => {
    try {
      printWindow.close()
    } catch {
      /* ignore */
    }
  }

  try {
    await writeAndPrepare(printWindow.document, printWindow, html)
    return await invokePrintAndCleanup(printWindow, cleanup)
  } catch (e: unknown) {
    cleanup()
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Failed to open the print dialog.",
    }
  }
}

/**
 * Print finished receipt HTML from the current POS/Sales History page without
 * leaving a visible receipt tab behind (preferred: hidden iframe).
 */
export async function printReceiptHtmlInBrowser(html: string): Promise<PrintHtmlResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { ok: false, message: "Printing is only available in the browser." }
  }
  if (!html || !html.trim()) {
    return { ok: false, message: "Receipt content is empty." }
  }
  if (printInFlight) {
    return { ok: false, message: "A print job is already in progress. Please wait." }
  }

  printInFlight = true
  try {
    const iframeResult = await printViaHiddenIframe(html)
    if (iframeResult.status === "printed") return { ok: true }
    if (iframeResult.status === "unavailable") return printViaTemporaryWindow(html)
    return { ok: false, message: iframeResult.message }
  } finally {
    printInFlight = false
  }
}
