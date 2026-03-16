/**
 * Standardized Export Utilities for Finza
 * 
 * Provides consistent CSV and Excel export functionality across all modules.
 * Ensures:
 * - All active filters are respected
 * - Exported data matches on-screen results
 * - Proper formatting (no currency symbols in CSV, proper cell types in Excel)
 * - Accountant-ready exports
 */

/**
 * Export data to CSV format
 * 
 * @param data - Array of data objects to export
 * @param columns - Column definitions with header, accessor, and optional formatter
 * @param filename - Output filename (without .csv extension)
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
): void {
  try {
    // Create header row
    const headers = columns.map((col) => col.header)
    
    // Create data rows
    const rows = data.map((item) =>
      columns.map((col) => {
        const value = col.accessor(item)
        // Format value if formatter provided, otherwise convert to string
        if (col.formatter) {
          return col.formatter(value, item)
        }
        // For CSV, convert to string and handle null/undefined
        if (value === null || value === undefined) {
          return ""
        }
        // Remove currency symbols and special formatting for CSV
        return String(value).replace(/[₵$€£,]/g, "").trim()
      })
    )

    // Combine headers and rows
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => {
          // Escape quotes and wrap in quotes if contains comma, newline, or quote
          const cellStr = String(cell)
          if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
            return `"${cellStr.replace(/"/g, '""')}"`
          }
          return cellStr
        }).join(",")
      ),
    ].join("\n")

    // Create blob with UTF-8 BOM for Excel compatibility
    const BOM = "\uFEFF"
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${filename}-${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error("Error exporting to CSV:", error)
    throw new Error("Failed to export to CSV. Please try again.")
  }
}

/**
 * Export data to Excel format using xlsx library
 * 
 * Note: Requires 'xlsx' package to be installed
 * Install with: npm install xlsx
 * 
 * @param data - Array of data objects to export
 * @param columns - Column definitions with header, accessor, and optional formatter
 * @param filename - Output filename (without .xlsx extension)
 */
export async function exportToExcel<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
): Promise<void> {
  try {
    // Dynamic import to avoid bundling xlsx if not used
    const XLSX = await import("xlsx")

    // Create worksheet data
    const worksheetData: any[][] = []

    // Add headers
    worksheetData.push(columns.map((col) => col.header))

    // Add data rows
    data.forEach((item) => {
      const row: any[] = columns.map((col) => {
        const value = col.accessor(item)
        if (col.formatter) {
          // For Excel, we want formatted values but also need to preserve types
          const formatted = col.formatter(value, item)
          // If formatter returns a number-like string, try to convert back to number
          if (col.excelType === "number" && typeof formatted === "string") {
            const numValue = parseFloat(formatted.replace(/[₵$€£,\s]/g, ""))
            return isNaN(numValue) ? formatted : numValue
          }
          if (col.excelType === "date" && formatted) {
            // Convert date string to Excel date serial number if possible
            const dateValue = new Date(formatted)
            if (!isNaN(dateValue.getTime())) {
              return dateValue
            }
          }
          return formatted
        }
        return value
      })
      worksheetData.push(row)
    })

    // Create workbook and worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

    // Set column widths (optional, but improves readability)
    const columnWidths = columns.map((col) => ({
      wch: col.width || 15,
    }))
    worksheet["!cols"] = columnWidths

    // Set cell types for better Excel formatting
    // Note: XLSX handles types automatically, but we can add styling if needed

    // Create workbook
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")

    // Generate Excel file
    XLSX.writeFile(workbook, `${filename}-${new Date().toISOString().split("T")[0]}.xlsx`)
  } catch (error) {
    console.error("Error exporting to Excel:", error)
    if (error instanceof Error && error.message.includes("Cannot find module")) {
      throw new Error("Excel export requires 'xlsx' package. Please install it with: npm install xlsx")
    }
    throw new Error("Failed to export to Excel. Please try again.")
  }
}

/**
 * Column definition for exports
 */
export interface ExportColumn<T> {
  /** Column header text */
  header: string
  /** Function to extract value from data item */
  accessor: (item: T) => any
  /** Optional formatter function */
  formatter?: (value: any, item: T) => string | number
  /** Excel cell type (for better formatting) */
  excelType?: "string" | "number" | "date" | "boolean"
  /** Column width for Excel (in characters) */
  width?: number
}

/**
 * Helper to format currency for display (with symbol)
 * Use this for Excel exports where formatting is desired
 * 
 * @param value - Numeric amount to format
 * @param currencyCode - ISO currency code (required, no fallbacks)
 * @param symbol - Currency symbol (required, no fallbacks)
 * @throws Error if currencyCode or symbol is missing
 */
export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string,
  symbol: string
): string {
  // Require currencyCode for exports - no fallbacks allowed
  if (!currencyCode) {
    throw new Error(
      "Currency code is required for export formatting. " +
      "Please ensure the data has a valid currencyCode before exporting."
    )
  }

  // Require symbol for exports - no fallbacks allowed
  if (!symbol) {
    throw new Error(
      "Currency symbol is required for export formatting. " +
      `Please provide the currency symbol for currency code: ${currencyCode}`
    )
  }

  if (value === null || value === undefined || isNaN(Number(value))) {
    return ""
  }

  return `${symbol}${Number(value).toFixed(2)}`
}

/**
 * Helper to format currency as raw number (no symbol)
 * Use this for CSV exports
 */
export function formatCurrencyRaw(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return ""
  }
  return Number(value).toFixed(2)
}

/**
 * Helper to format date
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return ""
  try {
    return new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
  } catch {
    return date
  }
}

/**
 * Helper to format date for Excel (returns Date object)
 */
export function formatDateForExcel(date: string | null | undefined): Date | string {
  if (!date) return ""
  try {
    return new Date(date)
  } catch {
    return date || ""
  }
}

/**
 * Helper to format Yes/No boolean
 */
export function formatYesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "No"
  }
  return value ? "Yes" : "No"
}

/**
 * Helper to format percentage
 */
export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return ""
  }
  return `${Number(value).toFixed(2)}%`
}













