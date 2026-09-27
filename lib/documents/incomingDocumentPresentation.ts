import { inboxStatusLabel } from "@/lib/documents/incomingOpenAiExtraction"

export type InboxDocumentRow = {
  id: string
  display_name: string
  document_kind: string
  source_type: string
  source_email_sender: string | null
  source_email_subject: string | null
  inbound_email_message_id?: string | null
  mime_type?: string | null
  status: string
  review_status: string
  document_date: string | null
  document_number: string | null
  supplier_name: string | null
  currency_code: string | null
  total: number | null
  linked_entity_type?: string | null
  linked_entity_id?: string | null
}

export type InboxPrimaryAction = "review" | "create_expense" | "create_bill" | "view_expense" | "view_bill"

export function formatInboxDate(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function formatInboxAmount(amount: number | null, currency: string | null): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null
  const code = currency || "GHS"
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

function documentWord(kind: string): string {
  if (kind === "expense_receipt") return "Receipt"
  if (kind === "supplier_bill_attachment") return "Invoice"
  return ""
}

export function inboxRowTitle(row: InboxDocumentRow): string {
  if (row.supplier_name?.trim()) return row.supplier_name.trim()
  if (row.source_type === "email_inbound" && row.source_email_sender?.trim()) return row.source_email_sender.trim()
  return row.display_name
}

export function inboxRowSecondary(row: InboxDocumentRow): string {
  const date = formatInboxDate(row.document_date)
  const number = row.document_number?.trim()
  if (number) {
    const word = documentWord(row.document_kind)
    return [word ? `${word} ${number}` : number, date].filter(Boolean).join(" · ")
  }
  if (row.source_type === "email_inbound" && row.source_email_subject?.trim()) {
    return [row.source_email_subject.trim(), date].filter(Boolean).join(" · ")
  }
  return date
}

export function inboxRowFileName(row: InboxDocumentRow): string | null {
  if (row.supplier_name?.trim()) return null
  const name = row.display_name?.trim()
  if (!name || name === inboxRowTitle(row)) return null
  return name
}

export function inboxRowFromLine(row: InboxDocumentRow): string | null {
  if (row.source_type !== "email_inbound") return null
  const sender = row.source_email_sender?.trim()
  if (!sender || sender === inboxRowTitle(row)) return null
  return `From ${sender}`
}

export function documentVisual(row: InboxDocumentRow): "pdf" | "image" | "file" {
  const mime = (row.mime_type || "").toLowerCase()
  const name = row.display_name.toLowerCase()
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf"
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(name)) return "image"
  return "file"
}

export function sharesInboundEmail(rows: InboxDocumentRow[], row: InboxDocumentRow): boolean {
  const messageId = row.inbound_email_message_id
  if (!messageId || row.source_type !== "email_inbound") return false
  return rows.filter((item) => item.inbound_email_message_id === messageId).length > 1
}

export function inboxPrimaryAction(row: InboxDocumentRow): InboxPrimaryAction {
  if (row.linked_entity_id) return row.linked_entity_type === "bill" ? "view_bill" : "view_expense"
  const ready = row.review_status === "accepted" || row.status === "reviewed"
  if (!ready || row.document_kind === "unknown") return "review"
  if (row.document_kind === "supplier_bill_attachment") return "create_bill"
  return "create_expense"
}

export function inboxPrimaryLabel(action: InboxPrimaryAction): string {
  if (action === "create_expense") return "Create expense"
  if (action === "create_bill") return "Create supplier bill"
  if (action === "view_expense") return "View expense"
  if (action === "view_bill") return "View supplier bill"
  return "Review document"
}

export function inboxStatusTone(label: string): "reading" | "review" | "ready" | "handled" | "failed" {
  if (label === "Reading…") return "reading"
  if (label === "Ready") return "ready"
  if (label === "Handled") return "handled"
  if (label === "Could not read") return "failed"
  return "review"
}

export function inboxStatusText(row: Pick<InboxDocumentRow, "status" | "review_status" | "linked_entity_id">): string {
  return inboxStatusLabel({
    status: row.status,
    reviewStatus: row.review_status,
    linked: Boolean(row.linked_entity_id),
  })
}

export function emailOriginLines(doc: {
  source_type?: string | null
  source_email_sender?: string | null
  source_email_subject?: string | null
  file_name?: string | null
  created_at?: string | null
  email_received_at?: string | null
}): Array<{ label: string; value: string }> {
  if (doc.source_type !== "email_inbound") return []
  const lines: Array<{ label: string; value: string }> = []
  if (doc.source_email_sender?.trim()) lines.push({ label: "From", value: doc.source_email_sender.trim() })
  if (doc.source_email_subject?.trim()) lines.push({ label: "Subject", value: doc.source_email_subject.trim() })
  const received = formatInboxDate(doc.email_received_at ?? null)
  if (received) lines.push({ label: "Received", value: received })
  else {
    const added = formatInboxDate(doc.created_at ?? null)
    if (added) lines.push({ label: "Added", value: added })
  }
  if (doc.file_name?.trim()) lines.push({ label: "Attachment", value: doc.file_name.trim() })
  return lines
}
