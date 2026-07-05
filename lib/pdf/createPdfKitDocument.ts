import fs from "fs"
import { createRequire } from "node:module"
import path from "path"

const nodeRequire = createRequire(path.join(process.cwd(), "package.json"))
const nativeReadFileSync = nodeRequire("fs").readFileSync as typeof fs.readFileSync
const nativeExistsSync = nodeRequire("fs").existsSync as typeof fs.existsSync

const PDFKIT_BUNDLED_DATA_DIR = path.join(process.cwd(), "lib", "pdf", "pdfkit-data")

let patchDepth = 0
let inNativeRead = false

function installPdfKitFontReadFallback(): () => void {
  const previousReadFileSync = fs.readFileSync

  if (patchDepth === 0) {
    fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
      if (inNativeRead) {
        return nativeReadFileSync(filePath, options)
      }

      if (typeof filePath === "string" && filePath.endsWith(".afm")) {
        const bundledPath = path.join(PDFKIT_BUNDLED_DATA_DIR, path.basename(filePath))
        if (nativeExistsSync(bundledPath)) {
          inNativeRead = true
          try {
            return nativeReadFileSync(bundledPath, options)
          } finally {
            inNativeRead = false
          }
        }
      }

      inNativeRead = true
      try {
        return nativeReadFileSync(filePath, options)
      } finally {
        inNativeRead = false
      }
    }) as typeof fs.readFileSync
  }

  patchDepth += 1
  return () => {
    patchDepth -= 1
    if (patchDepth === 0) {
      fs.readFileSync = previousReadFileSync
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

export function bundledPdfKitFontPath(name: "Helvetica" | "Helvetica-Bold"): string {
  return path.join(PDFKIT_BUNDLED_DATA_DIR, `${name}.afm`)
}
