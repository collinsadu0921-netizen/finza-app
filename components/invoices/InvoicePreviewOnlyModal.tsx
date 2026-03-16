"use client"

import { useState } from "react"

interface InvoicePreviewOnlyModalProps {
  invoiceId: string
  isOpen: boolean
  onClose: () => void
}

export default function InvoicePreviewOnlyModal({
  invoiceId,
  isOpen,
  onClose,
}: InvoicePreviewOnlyModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  if (!isOpen) return null

  const previewUrl = `/api/invoices/${invoiceId}/pdf-preview`

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Invoice Preview</h2>
            <p className="text-sm text-gray-500 mt-1">Review your invoice</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* PDF Preview */}
        <div className="flex-1 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading preview...</p>
              </div>
            </div>
          )}
          <iframe
            src={previewUrl}
            className="w-full h-full border-0"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false)
              setError("Failed to load preview")
            }}
            title="Invoice Preview"
          />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={() => {
                    setError("")
                    setLoading(true)
                    const iframe = document.querySelector('iframe[title="Invoice Preview"]') as HTMLIFrameElement
                    if (iframe) {
                      iframe.src = previewUrl
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Only Close Button */}
        <div className="flex items-center justify-end p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

