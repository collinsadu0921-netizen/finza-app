import type { MaskedBusinessPaymentProviderForUi, PaymentProviderEnvironment } from "@/lib/tenantPayments/types"

/** Aggregated GET for the service payment settings page (MTN + Hubtel, one environment). */
export type IntegratedProviderSlice = {
  /** Canonical row id, or null when only legacy JSON exists (first save will POST). */
  provider_id: string | null
  source: "canonical" | "legacy_fallback"
  masked: MaskedBusinessPaymentProviderForUi
  /**
   * Authenticated settings GET only: unmasked `public_config` for `manual_wallet` so staff can edit
   * wallet_number. Never include this on public/customer responses.
   */
  settings_public?: Record<string, unknown> | null
}

export type PaymentSettingsIntegratedView = {
  business_id: string
  environment: PaymentProviderEnvironment
  /** All provider rows in this environment (masked). May include types beyond MTN/Hubtel. */
  providers: MaskedBusinessPaymentProviderForUi[]
  mtn_momo_direct: IntegratedProviderSlice
  hubtel: IntegratedProviderSlice
  /** Canonical `manual_wallet` row only (no legacy JSON path). */
  manual_wallet: IntegratedProviderSlice
}

export type CreatePaymentProviderBody = {
  business_id: string
  environment: PaymentProviderEnvironment
  provider_type: "mtn_momo_direct" | "hubtel" | "manual_wallet"
  is_enabled?: boolean
  is_default?: boolean
  public_config: Record<string, unknown>
  /** Plain secrets; omitted fields are merged from existing row or legacy JSON on update paths. For POST, merge uses legacy when row does not exist. */
  secrets?: Record<string, unknown>
}

export type PatchPaymentProviderBody = {
  business_id: string
  public_config?: Record<string, unknown>
  secrets?: Record<string, unknown>
  is_enabled?: boolean
  validation_status?: "unvalidated" | "valid" | "invalid"
}
