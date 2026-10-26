export type AuditActorKind = "user" | "system" | "unknown"

export type AuditLogDisplay = {
  action_type: string
  entity_type: string
  entity_id?: string | null
  description?: string | null
  user_id?: string | null
  new_values?: Record<string, unknown> | null
  user?: {
    id?: string
    name?: string | null
    display_name?: string | null
    label?: string | null
    email?: string | null
  } | null
  actor_kind?: AuditActorKind
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function humanize(value: string): string {
  const words = value.replace(/[._]+/g, " ").trim().toLowerCase()
  if (!words) return "Activity"
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true"
}

function isSystemAccountCreation(log: AuditLogDisplay): boolean {
  return (
    !log.user_id &&
    log.action_type === "account.created" &&
    isTrue(log.new_values?.is_system)
  )
}

export function auditActorKind(log: AuditLogDisplay): AuditActorKind {
  if (log.actor_kind) return log.actor_kind
  if (log.user_id) return log.user ? "user" : "unknown"
  return isSystemAccountCreation(log) ? "system" : "unknown"
}

export function auditActorLabel(log: AuditLogDisplay): string {
  const kind = auditActorKind(log)
  if (kind === "system") return "System"
  if (kind === "unknown") return "Unknown actor"
  return (
    text(log.user?.display_name) ??
    text(log.user?.name) ??
    text(log.user?.label) ??
    text(log.user?.email) ??
    "Unknown actor"
  )
}

export function formatAuditAction(log: AuditLogDisplay): string {
  const action = log.action_type
  const values = log.new_values ?? {}

  if (action === "journal_entry.created") {
    return values.source_type === "service_manual"
      ? "Manual journal posted"
      : "Journal entry created"
  }
  if (action === "reversal") {
    return log.entity_type === "journal_entry"
      ? "Journal entry reversed"
      : "Reversal"
  }
  if (action === "account.created" && isSystemAccountCreation(log)) {
    return "System account created"
  }
  return humanize(action)
}

export function formatAuditEntity(log: AuditLogDisplay): string {
  const values = log.new_values ?? {}

  if (log.entity_type === "journal_entry") {
    const reference = text(values.reference)
    const isManual =
      values.source_type === "service_manual" ||
      values.reference_type === "manual"
    const base = isManual ? "Manual journal" : "Journal entry"
    return reference ? `${base} · ${reference}` : base
  }

  if (log.entity_type === "account") {
    const name = text(values.name)
    const code = text(values.code)
    if (name && code) return `Account · ${name} (${code})`
    if (name) return `Account · ${name}`
    if (code) return `Account · ${code}`
    return "Account"
  }

  const number =
    text(values.bill_number) ??
    text(values.invoice_number) ??
    text(values.reference)
  const base = humanize(log.entity_type)
  return number ? `${base} · ${number}` : base
}

export function formatAuditSummary(log: AuditLogDisplay): string {
  const explicit = text(log.description)
  if (explicit) return explicit

  const values = log.new_values ?? {}
  const description = text(values.description)
  const reference = text(values.reference)

  if (description && reference) return `${description} · ${reference}`
  if (description) return description
  if (reference) return reference

  const name = text(values.name)
  const code = text(values.code)
  if (name && code) return `${name} (${code})`
  if (name) return name
  if (code) return code

  return "—"
}
