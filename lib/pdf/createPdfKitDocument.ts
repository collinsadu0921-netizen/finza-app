import fs from "fs"
import { existsSync } from "node:fs"
import path from "path"

const PDFKIT_BUNDLED_DATA_DIR = path.join(process.cwd(), "lib", "pdf", "pdfkit-data")

// Capture before any patch; pdfkit and node:fs share this function reference.
const nativeReadFileSync = fs.readFileSync.bind(fs)

let patchDepth = 0

function installPdfKitFontReadFallback(): () => void {
  if (patchDepth === 0) {
    fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
      if (typeof filePath === "string" && filePath.endsWith(".afm")) {
        const bundledPath = path.join(PDFKIT_BUNDLED_DATA_DIR, path.basename(filePath))
        if (existsSync(bundledPath)) {
          return nativeReadFileSync(bundledPath, options)
        }
      }
      return nativeReadFileSync(filePath, options)
    }) as typeof fs.readFileSync
  }

  patchDepth += 1
  return () => {
    patchDepth -= 1
    if (patchDepth === 0) {
      fs.readFileSync = nativeReadFileSync
    }
  }
}

/**
 * pdfkit reads standard-font .afm files from node_modules at runtime. Vercel NFT
 * often omits those files even with outputFileTracingIncludes. Fall back to AFM
 * metrics vendored under lib/pdf/pdfkit-data (Adobe PDF standard fonts).
 */
export function withPdfKitBundledFonts<T>(run: () => T): T {
  const restore = installPdfKitFontReadFallback()
  try {
    return run()
  } finally {
    restore()
  }
}

export async function withPdfKitBundledFontsAsync<T>(run: () => Promise<T>): Promise<T> {
  const restore = installPdfKitFontReadFallback()
  try {
    return await run()
  } finally {
    restore()
  }
}

export async function createPdfKitDocument(options?: Record<string, unknown>): Promise<any> {
  const pdfkitModule = await import("pdfkit")
  const PDFDocument = pdfkitModule.default ?? pdfkitModule
  return withPdfKitBundledFonts(() => new PDFDocument(options))
}
