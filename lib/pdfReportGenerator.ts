/**
 * PDF Report Generator Utilities
 * 
 * Provides server-side PDF generation for financial reports.
 * Uses pdfkit for deterministic PDF generation.
 * 
 * Note: Requires 'pdfkit' package to be installed.
 * Install with: npm install pdfkit @types/pdfkit
 */

/**
 * Create a PDF document with standard report layout
 */
export async function createReportPDF(title: string, subtitle: string): Promise<any> {
  try {
    // Dynamic import to avoid bundling pdfkit if not used
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({
      size: "A4",
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50,
      },
    })

    // Add title
    doc.fontSize(18).font("Helvetica-Bold").text(title, { align: "center" })
    doc.moveDown(0.5)

    // Add subtitle
    doc.fontSize(12).font("Helvetica").text(subtitle, { align: "center" })
    doc.moveDown(1)

    return doc
  } catch (error: any) {
    if (error.message?.includes("Cannot find module")) {
      throw new Error("PDF generation requires 'pdfkit' package. Please install it with: npm install pdfkit @types/pdfkit")
    }
    throw error
  }
}

/**
 * Add a table to PDF document
 */
export function addTableToPDF(
  doc: any,
  headers: string[],
  rows: string[][],
  columnWidths: number[],
  options?: {
    headerFontSize?: number
    bodyFontSize?: number
    rowHeight?: number
  }
): void {
  const headerFontSize = options?.headerFontSize || 10
  const bodyFontSize = options?.bodyFontSize || 9
  const rowHeight = options?.rowHeight || 20

  // Table header
  doc.fontSize(headerFontSize).font("Helvetica-Bold")
  let x = doc.page.margins.left
  let y = doc.y

  headers.forEach((header, i) => {
    doc.rect(x, y, columnWidths[i], rowHeight).stroke()
    doc.text(header, x + 5, y + 5, {
      width: columnWidths[i] - 10,
      align: "left",
    })
    x += columnWidths[i]
  })

  y += rowHeight

  // Table rows
  doc.fontSize(bodyFontSize).font("Helvetica")
  rows.forEach((row) => {
    x = doc.page.margins.left
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
      y = doc.page.margins.top
    }

    row.forEach((cell, i) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(cell, x + 5, y + 5, {
        width: columnWidths[i] - 10,
        align: i === row.length - 1 ? "right" : "left", // Right-align last column (usually numbers)
      })
      x += columnWidths[i]
    })
    y += rowHeight
  })

  doc.y = y + 10
}

/**
 * Add totals row to PDF
 */
export function addTotalsRowToPDF(
  doc: any,
  label: string,
  value: string,
  columnWidths: number[],
  options?: {
    fontSize?: number
    rowHeight?: number
  }
): void {
  const fontSize = options?.fontSize || 10
  const rowHeight = options?.rowHeight || 20

  if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }

  doc.fontSize(fontSize).font("Helvetica-Bold")
  let x = doc.page.margins.left

  // First column: label
  doc.rect(x, doc.y, columnWidths[0], rowHeight).fillAndStroke("#F0F0F0", "#000000")
  doc.text(label, x + 5, doc.y + 5, {
    width: columnWidths[0] - 10,
    align: "left",
  })
  x += columnWidths[0]

  // Remaining columns: empty or value in last column
  for (let i = 1; i < columnWidths.length - 1; i++) {
    doc.rect(x, doc.y, columnWidths[i], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    x += columnWidths[i]
  }

  // Last column: value (right-aligned)
  doc.rect(x, doc.y, columnWidths[columnWidths.length - 1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
  doc.text(value, x + 5, doc.y + 5, {
    width: columnWidths[columnWidths.length - 1] - 10,
    align: "right",
  })

  doc.y += rowHeight + 10
}

/**
 * Add footer to PDF
 */
export function addFooterToPDF(doc: any): void {
  const pageHeight = doc.page.height
  const pageWidth = doc.page.width
  const footerY = pageHeight - doc.page.margins.bottom - 20

  doc.fontSize(8).font("Helvetica")
  doc.text(`Generated on ${new Date().toISOString()}`, doc.page.margins.left, footerY, {
    align: "left",
  })
  doc.text("FINZA — Read-only report", pageWidth - doc.page.margins.right, footerY, {
    align: "right",
  })
}

/**
 * Format numeric value for PDF (no currency symbols, 2 decimal places)
 */
export function formatNumericForPDF(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
