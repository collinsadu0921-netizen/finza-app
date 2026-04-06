/**
 * Structured errors for tenant payment provider configuration.
 * Server-only consumers; never serialize stack traces to clients in production APIs.
 */

export type TenantPaymentErrorCode =
  | "ENCRYPTION_KEY_MISSING"
  | "ENCRYPTION_KEY_INVALID"
  | "ENCRYPT_FAILED"
  | "DECRYPT_FAILED"
  | "MALFORMED_SECRET_PAYLOAD"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "INVALID_PROVIDER_CONFIG"
  | "UNSUPPORTED_PROVIDER_TYPE"
  | "NO_DEFAULT_PROVIDER"
  | "INVOICE_NOT_FOUND"
  | "SALE_RESOLUTION_NOT_IMPLEMENTED"

export class TenantPaymentConfigError extends Error {
  readonly code: TenantPaymentErrorCode

  constructor(code: TenantPaymentErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = "TenantPaymentConfigError"
    this.code = code
  }
}

export class TenantPaymentEncryptionKeyMissingError extends TenantPaymentConfigError {
  constructor(message = "TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY is not set") {
    super("ENCRYPTION_KEY_MISSING", message)
    this.name = "TenantPaymentEncryptionKeyMissingError"
  }
}

export class TenantPaymentEncryptionKeyInvalidError extends TenantPaymentConfigError {
  constructor(
    message = "TENANT_PAYMENT_CONFIG_ENCRYPTION_KEY must be 32 bytes as 64 hex chars or base64/base64url of 32 raw bytes (see .env.example)."
  ) {
    super("ENCRYPTION_KEY_INVALID", message)
    this.name = "TenantPaymentEncryptionKeyInvalidError"
  }
}

export class TenantPaymentEncryptError extends TenantPaymentConfigError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ENCRYPT_FAILED", message, options)
    this.name = "TenantPaymentEncryptError"
  }
}

export class TenantPaymentDecryptError extends TenantPaymentConfigError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("DECRYPT_FAILED", message, options)
    this.name = "TenantPaymentDecryptError"
  }
}

export class TenantPaymentMalformedSecretPayloadError extends TenantPaymentConfigError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("MALFORMED_SECRET_PAYLOAD", message, options)
    this.name = "TenantPaymentMalformedSecretPayloadError"
  }
}

export class TenantPaymentProviderNotFoundError extends TenantPaymentConfigError {
  constructor(message: string) {
    super("PROVIDER_NOT_FOUND", message)
    this.name = "TenantPaymentProviderNotFoundError"
  }
}

export class TenantPaymentProviderDisabledError extends TenantPaymentConfigError {
  constructor(message: string) {
    super("PROVIDER_DISABLED", message)
    this.name = "TenantPaymentProviderDisabledError"
  }
}

export class TenantPaymentInvalidConfigError extends TenantPaymentConfigError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("INVALID_PROVIDER_CONFIG", message, options)
    this.name = "TenantPaymentInvalidConfigError"
  }
}

export class TenantPaymentUnsupportedProviderTypeError extends TenantPaymentConfigError {
  constructor(message: string) {
    super("UNSUPPORTED_PROVIDER_TYPE", message)
    this.name = "TenantPaymentUnsupportedProviderTypeError"
  }
}

export class TenantPaymentNoDefaultProviderError extends TenantPaymentConfigError {
  constructor(message: string) {
    super("NO_DEFAULT_PROVIDER", message)
    this.name = "TenantPaymentNoDefaultProviderError"
  }
}

export class TenantPaymentInvoiceNotFoundError extends TenantPaymentConfigError {
  constructor(message: string) {
    super("INVOICE_NOT_FOUND", message)
    this.name = "TenantPaymentInvoiceNotFoundError"
  }
}

export class TenantPaymentSaleResolutionNotImplementedError extends TenantPaymentConfigError {
  constructor(
    message = "resolveTenantProviderForSale is not implemented yet; use invoice resolution or pass business_id explicitly."
  ) {
    super("SALE_RESOLUTION_NOT_IMPLEMENTED", message)
    this.name = "TenantPaymentSaleResolutionNotImplementedError"
  }
}
