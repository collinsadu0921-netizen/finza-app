export const SUPPORT_REQUEST_CATEGORIES = [
  "Billing / subscription",
  "Invoices",
  "Credit notes",
  "Receipts",
  "Payments",
  "Customers",
  "Expenses",
  "Bills",
  "Payroll",
  "Reports",
  "Team / permissions",
  "Settings",
  "Bug report",
  "Feature request",
  "Other",
] as const

export type SupportRequestCategory = (typeof SUPPORT_REQUEST_CATEGORIES)[number]

export const SUPPORT_URGENCY_VALUES = ["normal", "urgent"] as const
export type SupportUrgency = (typeof SUPPORT_URGENCY_VALUES)[number]

export const MESSAGE_MIN_LENGTH = 10
export const MESSAGE_MAX_LENGTH = 5000
export const SUBJECT_MAX_LENGTH = 200

export function isSupportRequestCategory(value: string): value is SupportRequestCategory {
  return (SUPPORT_REQUEST_CATEGORIES as readonly string[]).includes(value)
}

export function isSupportUrgency(value: string): value is SupportUrgency {
  return (SUPPORT_URGENCY_VALUES as readonly string[]).includes(value)
}

export function validateSupportRequestInput(input: {
  category?: unknown
  subject?: unknown
  message?: unknown
  urgency?: unknown
}): { ok: true; data: { category: SupportRequestCategory; subject: string | null; message: string; urgency: SupportUrgency } } | { ok: false; error: string } {
  const category = typeof input.category === "string" ? input.category.trim() : ""
  if (!category || !isSupportRequestCategory(category)) {
    return { ok: false, error: "A valid category is required" }
  }

  const message = typeof input.message === "string" ? input.message.trim() : ""
  if (message.length < MESSAGE_MIN_LENGTH) {
    return { ok: false, error: `Message must be at least ${MESSAGE_MIN_LENGTH} characters` }
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Message must be at most ${MESSAGE_MAX_LENGTH} characters` }
  }

  const subjectRaw = typeof input.subject === "string" ? input.subject.trim() : ""
  const subject = subjectRaw.length > 0 ? subjectRaw.slice(0, SUBJECT_MAX_LENGTH) : null

  const urgencyRaw = typeof input.urgency === "string" ? input.urgency.trim() : "normal"
  const urgency: SupportUrgency = isSupportUrgency(urgencyRaw) ? urgencyRaw : "normal"

  return { ok: true, data: { category, subject, message, urgency } }
}
