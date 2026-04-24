/**
 * Provider-agnostic shape consumed by inboundEmailIngestionService.
 * Populated by webhook adapters (e.g. Resend email.received).
 */

export type InboundEmailAttachmentInput = {
  providerAttachmentId: string
  fileName: string | null
  contentType: string | null
  downloadUrl: string
  fileSizeBytes: number | null
}

export type NormalizedInboundEmailPayload = {
  provider: "resend"
  providerMessageId: string
  recipientAddresses: string[]
  senderAddress: string | null
  subject: string | null
  receivedAtIso: string
  snippetText?: string | null
  attachments: InboundEmailAttachmentInput[]
  metadata?: Record<string, unknown>
}
