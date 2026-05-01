"use client"

import {
  showTenantBankPaymentCard,
  showTenantMomoPaymentCard,
} from "@/lib/invoices/invoicePaymentDetailsDisplay"

/** Public-safe bank/MoMo + terms from invoice_settings (and optional manual-wallet row). */
export type InvoiceManualPaymentDetailsProps = {
  bank_name?: string | null
  bank_branch?: string | null
  bank_swift?: string | null
  bank_iban?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  momo_provider?: string | null
  momo_name?: string | null
  momo_number?: string | null
  payment_terms?: string | null
  footer_message?: string | null
}

export type ManualWalletPaymentDisplay = {
  provider_type: "manual_wallet"
  network: string | null
  account_name: string | null
  wallet_number: string | null
  instructions: string | null
  display_label: string | null
}

type Props = {
  details: InvoiceManualPaymentDetailsProps | null
  manualWallet?: ManualWalletPaymentDisplay | null
  /** Optional extra line under the neutral pay reminder (e.g. `/pay` legacy links). */
  payFallbackSubtitle?: string | null
  /** When true, show a short neutral reminder (for `/pay` when online collection is off). */
  showPayFallbackBanner?: boolean
  className?: string
}

export function ManualInvoicePaymentDetails({
  details,
  manualWallet,
  payFallbackSubtitle,
  showPayFallbackBanner,
  className = "",
}: Props) {
  const d = details || {}
  const hasBank = showTenantBankPaymentCard(d)
  const hasMomo = showTenantMomoPaymentCard(d)
  const hasTerms = !!(d.payment_terms?.trim())
  const hasFooter = !!(d.footer_message?.trim())
  const hasManualWallet =
    !!manualWallet &&
    (!!manualWallet.wallet_number?.trim() ||
      !!manualWallet.account_name?.trim() ||
      !!manualWallet.instructions?.trim() ||
      !!manualWallet.display_label?.trim())

  const hasAnyPaymentCopy = hasBank || hasMomo || hasTerms || hasFooter || hasManualWallet

  if (!hasAnyPaymentCopy && !showPayFallbackBanner) {
    return null
  }

  const fallbackBannerText =
    payFallbackSubtitle?.trim() ||
    "Please use the payment details provided by the business."

  if (!hasAnyPaymentCopy && showPayFallbackBanner) {
    return (
      <div className={`space-y-3 text-sm ${className}`}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800">
          <p className="font-medium text-slate-900 leading-relaxed">{fallbackBannerText}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-4 text-sm ${className}`}>
      {showPayFallbackBanner && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800">
          <p className="font-medium text-slate-900 leading-relaxed">{fallbackBannerText}</p>
        </div>
      )}

      {(hasBank || hasMomo) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900 mb-1">Payment details</p>
          <p className="text-xs text-slate-600 mb-3">Please use the payment details below when making payment.</p>
          {hasBank && (
            <div className="mb-4 space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">Bank transfer</p>
              {d.bank_name?.trim() && <p className="text-slate-800 font-medium">{d.bank_name}</p>}
              {d.bank_account_name?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">Account name: </span>
                  <span className="font-medium text-slate-800">{d.bank_account_name}</span>
                </p>
              )}
              {d.bank_account_number?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">Account number: </span>
                  <span className="font-mono font-semibold text-slate-900">{d.bank_account_number}</span>
                </p>
              )}
              {d.bank_branch?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">Branch: </span>
                  {d.bank_branch}
                </p>
              )}
              {d.bank_swift?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">SWIFT: </span>
                  <span className="font-mono">{d.bank_swift}</span>
                </p>
              )}
              {d.bank_iban?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">IBAN: </span>
                  <span className="font-mono break-all">{d.bank_iban}</span>
                </p>
              )}
            </div>
          )}
          {hasMomo && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">Mobile money</p>
              <p className="text-slate-800 font-medium">
                {d.momo_provider?.trim() ? d.momo_provider.trim() : "Mobile money"}
              </p>
              {d.momo_name?.trim() && (
                <p className="text-slate-600">
                  <span className="text-slate-500">Account name: </span>
                  <span className="font-medium text-slate-800">{d.momo_name}</span>
                </p>
              )}
              <p className="text-slate-600">
                <span className="text-slate-500">Number: </span>
                <span className="font-mono font-semibold text-slate-900">{d.momo_number}</span>
              </p>
            </div>
          )}
        </div>
      )}

      {hasManualWallet && manualWallet && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 mb-2">Manual payment</p>
          <p className="text-sm text-amber-950/90 mb-3">
            Use the details below to transfer funds. The business will record your payment and update this invoice — there
            is no instant confirmation from this screen.
          </p>
          {manualWallet.display_label && (
            <p className="text-sm font-semibold text-slate-900 mb-2">{manualWallet.display_label}</p>
          )}
          <dl className="space-y-2 text-sm text-slate-800">
            {manualWallet.network && (
              <div className="flex justify-between gap-4 border-b border-amber-200/60 pb-2">
                <dt className="text-slate-600">Network</dt>
                <dd className="font-medium text-right">{manualWallet.network}</dd>
              </div>
            )}
            {manualWallet.account_name && (
              <div className="flex justify-between gap-4 border-b border-amber-200/60 pb-2">
                <dt className="text-slate-600">Account name</dt>
                <dd className="font-medium text-right">{manualWallet.account_name}</dd>
              </div>
            )}
            {manualWallet.wallet_number && (
              <div className="flex justify-between gap-4 border-b border-amber-200/60 pb-2">
                <dt className="text-slate-600">Wallet number</dt>
                <dd className="font-mono font-semibold text-right">{manualWallet.wallet_number}</dd>
              </div>
            )}
          </dl>
          {manualWallet.instructions && (
            <p className="mt-3 text-sm text-slate-800 whitespace-pre-line border-t border-amber-200/80 pt-3">
              {manualWallet.instructions}
            </p>
          )}
        </div>
      )}

      {hasTerms && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Payment instructions</p>
          <p className="text-slate-700 whitespace-pre-line leading-relaxed">{d.payment_terms}</p>
        </div>
      )}

      {hasFooter && (
        <p className="text-xs text-slate-500 text-center whitespace-pre-line border-t border-slate-200 pt-3">
          {d.footer_message}
        </p>
      )}
    </div>
  )
}
