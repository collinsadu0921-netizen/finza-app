import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * Helper function to escape CSV values
 */
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return ""
  }
  const stringValue = String(value)
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

/**
 * Helper function to format numeric values for CSV
 */
function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "0"
  }
  return String(value)
}

/**
 * GET /api/accounting/afs/runs/[id]/export/csv
 * 
 * Exports AFS run documents as CSV
 * Supports export of Trial Balance, P&L, and Balance Sheet documents
 * 
 * Query Parameters:
 * - business_id (required)
 * - document_type (optional) - filter by document type (trial_balance, profit_loss, balance_sheet)
 * 
 * Access: Admin/Owner/Accountant (read or write)
 * 
 * CSV Format:
 * - Includes input_hash and metadata in header
 * - Document-specific columns based on document_type
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    const documentType = searchParams.get("document_type")

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export AFS runs." },
        { status: 403 }
      )
    }

    // Get the AFS run
    const { data: run, error: runError } = await supabase
      .from("afs_runs")
      .select("*")
      .eq("id", id)
      .eq("business_id", businessId)
      .single()

    if (runError || !run) {
      return NextResponse.json(
        { error: "AFS run not found" },
        { status: 404 }
      )
    }

    // Get documents (filter by type if provided)
    let query = supabase
      .from("afs_documents")
      .select("*")
      .eq("afs_run_id", id)
      .order("created_at", { ascending: true })

    if (documentType) {
      query = query.eq("document_type", documentType)
    }

    const { data: documents, error: documentsError } = await query

    if (documentsError) {
      console.error("Error fetching AFS documents:", documentsError)
      return NextResponse.json(
        { error: documentsError.message || "Failed to fetch AFS documents" },
        { status: 500 }
      )
    }

    if (!documents || documents.length === 0) {
      return NextResponse.json(
        { error: "No documents found for this AFS run" },
        { status: 404 }
      )
    }

    // Generate CSV
    const csvRows: string[] = []
    
    // Metadata rows
    csvRows.push("# AFS Run Export")
    csvRows.push(`# Run ID,${run.id}`)
    csvRows.push(`# Status,${run.status}`)
    csvRows.push(`# Input Hash,${run.input_hash}`)
    csvRows.push(`# Period Start,${run.period_start || ""}`)
    csvRows.push(`# Period End,${run.period_end || ""}`)
    if (run.finalized_at) {
      csvRows.push(`# Finalized At,${run.finalized_at}`)
    }
    csvRows.push(`# Generated,${new Date().toISOString()}`)
    csvRows.push("# FINZA,Read-only report")
    csvRows.push("")

    // Export each document
    for (const doc of documents) {
      csvRows.push(`# Document Type,${doc.document_type}`)
      csvRows.push("")
      
      // Basic CSV format - document_data should be JSONB
      // For now, export as JSON lines (can be enhanced later with specific formatting)
      if (doc.document_data) {
        try {
          const data = typeof doc.document_data === "string" 
            ? JSON.parse(doc.document_data) 
            : doc.document_data
          
          // If data is an array, export as CSV table
          if (Array.isArray(data) && data.length > 0) {
            // Get headers from first row
            const firstRow = data[0]
            const headers = Object.keys(firstRow)
            csvRows.push(headers.map(escapeCsvValue).join(","))
            
            // Add data rows
            for (const row of data) {
              const values = headers.map(header => {
                const value = row[header]
                if (typeof value === "number") {
                  return formatNumeric(value)
                }
                return escapeCsvValue(value)
              })
              csvRows.push(values.join(","))
            }
          } else {
            // Single object - export as key-value pairs
            csvRows.push("Key,Value")
            for (const [key, value] of Object.entries(data)) {
              csvRows.push(`${escapeCsvValue(key)},${escapeCsvValue(value)}`)
            }
          }
        } catch (parseError) {
          // If parsing fails, export raw JSON
          csvRows.push("JSON Data")
          csvRows.push(escapeCsvValue(JSON.stringify(doc.document_data)))
        }
      }
      
      csvRows.push("")
    }

    const csvContent = csvRows.join("\n")
    
    // Return CSV response with UTF-8 BOM
    return new NextResponse("\ufeff" + csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="afs-run-${id}${documentType ? `-${documentType}` : ""}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Error in AFS CSV export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
