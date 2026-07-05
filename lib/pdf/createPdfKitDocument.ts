import fs from "fs"
import path from "path"

const PDFKIT_BUNDLED_DATA_DIR = path.join(process.cwd(), "lib", "pdf", "pdfkit-data")

function installPdfKitFontReadFallback(): () => void {
  const originalReadFileSync = fs.readFileSync
  const patchedReadFileSync = ((filePath: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
    if (typeof filePath === "string" && filePath.endsWith(".afm")) {
      const bundledPath = path.join(PDFKIT_BUNDLED_DATA_DIR, path.basename(filePath))
      if (fs.existsSync(bundledPath)) {
        return originalReadFileSync(bundledPath, options)
      }
    }
    return originalReadFileSync(filePath, options)
  }) as typeof fs.readFileSync

  fs.readFileSync = patchedReadFileSync
  return () => {
    fs.readFileSync = originalReadFileSync
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
