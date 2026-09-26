/** Staging preview sets this at build time. Production leaves it unset. */
export const receiptAiUiEnabled = process.env.NEXT_PUBLIC_RECEIPT_AI_ENABLED === "true"
