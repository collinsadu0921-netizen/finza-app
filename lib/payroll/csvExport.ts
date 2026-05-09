import { NextResponse } from "next/server"

export function escapeCsvValue(value: unknown): string {
  const str = String(value ?? "")
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function formatNumeric(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "0.00"
  return n.toFixed(2)
}

export function toCsv(rows: string[][]): string {
  const BOM = "\uFEFF"
  return BOM + rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n")
}

export function csvResponse(filename: string, rows: string[][]): NextResponse {
  return new NextResponse(toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}

