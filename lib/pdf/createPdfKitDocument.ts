/**
 * Load pdfkit with standard fonts embedded (no runtime .afm filesystem reads).
 * The standalone build avoids Vercel ENOENT on Helvetica.afm.
 */
export async function createPdfKitDocument(
  options?: Record<string, unknown>
): Promise<any> {
  const pdfkitModule = await import("pdfkit/js/pdfkit.standalone.js")
  const PDFDocument = pdfkitModule.default ?? pdfkitModule
  return new PDFDocument(options)
}
