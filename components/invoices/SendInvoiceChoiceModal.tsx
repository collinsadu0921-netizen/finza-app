"use client"

import { useState } from "react"

export type SendMethod = "whatsapp" | "email" | "both" | "link"

type Customer = {
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
}

export default function SendInvoiceChoiceModal({
  invoiceId,
  customer,
  onSend,
  onSkip,
}: {
  invoiceId: string
  customer: Customer | null
  onSend: (method: SendMethod) => void
  onSkip: () => void
}) {
  const [selectedMethod, setSelectedMethod] = useState<SendMethod | null>(null)

  const hasPhone = !!(customer?.phone || customer?.whatsapp_phone)
  const hasEmail = !!customer?.email
  const hasBoth = hasPhone && hasEmail

  // Determine available methods
  const availableMethods: Array<{ method: SendMethod; label: string; icon: JSX.Element; enabled: boolean }> = [
    {
      method: "whatsapp",
      label: "WhatsApp",
      enabled: hasPhone,
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
        </svg>
      ),
    },
    {
      method: "email",
      label: "Email",
      enabled: hasEmail,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      method: "both",
      label: "Both (WhatsApp + Email)",
      enabled: hasBoth,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      method: "link",
      label: "Copy Link Only",
      enabled: true,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
  ]

  const handleSend = () => {
    if (selectedMethod) {
      onSend(selectedMethod)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Invoice Created!</h2>
          <p className="text-gray-600">How would you like to send this invoice?</p>
        </div>

        <div className="space-y-2 mb-6">
          {availableMethods.map((option) => (
            <button
              key={option.method}
              type="button"
              onClick={() => option.enabled && setSelectedMethod(option.method)}
              disabled={!option.enabled}
              className={`
                w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all
                ${selectedMethod === option.method
                  ? "border-blue-600 bg-blue-50"
                  : option.enabled
                  ? "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  : "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                }
              `}
            >
              <div className={`${selectedMethod === option.method ? "text-blue-600" : "text-gray-600"}`}>
                {option.icon}
              </div>
              <div className="flex-1 text-left">
                <div className={`font-medium ${selectedMethod === option.method ? "text-blue-900" : "text-gray-900"}`}>
                  {option.label}
                </div>
                {!option.enabled && (
                  <div className="text-xs text-gray-500 mt-1">
                    {option.method === "whatsapp" && "Customer phone number required"}
                    {option.method === "email" && "Customer email required"}
                    {option.method === "both" && "Customer phone and email required"}
                  </div>
                )}
              </div>
              {selectedMethod === option.method && (
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Skip for Now
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!selectedMethod}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-medium hover:from-green-700 hover:to-green-800 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Send Invoice
          </button>
        </div>
      </div>
    </div>
  )
}

