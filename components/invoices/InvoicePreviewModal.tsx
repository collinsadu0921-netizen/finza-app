"use client"

import { useState, useEffect, useRef } from "react"
import { downloadInvoiceHtmlDocument } from "@/lib/invoices/downloadInvoiceHtmlClient"

interface InvoicePreviewModalProps {
  invoiceId: string
  isOpen: boolean
  onClose: () => void
  onError?: (message: string) => void
  previewData?: any // Optional preview data for unsaved invoices
  /** For download filename; optional when invoice has no number yet (draft). */
  invoiceNumber?: string | null
  businessId?: string | null
  /** When "draft", file download is only available after Issue & download from Send — not from preview. */
  invoiceStatus?: string | null
}

export default function InvoicePreviewModal({
  invoiceId,
  isOpen,
  onClose,
  onError,
  previewData,
  invoiceNumber,
  businessId,
  invoiceStatus,
}: InvoicePreviewModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [downloadLoading, setDownloadLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isDraftPreview = Boolean(previewData || invoiceId === "preview")
  const canDownloadSaved =
    !isDraftPreview &&
    Boolean(invoiceId) &&
    invoiceId !== "preview" &&
    invoiceStatus !== "draft"

  useEffect(() => {
    if (!isOpen) return

    setLoading(true)
    setError("")
    
    // If previewData is provided or invoiceId is "preview", use form data (draft preview – no invoice_id)
    if (previewData || invoiceId === "preview") {
      const data = previewData || (window as any).__previewData

      if (!data) {
        setError("Preview data not available")
        setLoading(false)
        if (onError) {
          onError("Preview data not available")
        }
        return
      }

      // Draft preview: POST to preview-draft (no DB insert, no invoice number)
      fetch("/api/invoices/preview-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(async response => {
          if (!response.ok) {
            let errorMessage = 'Failed to generate preview'
            try {
              const errorData = await response.json()
              errorMessage = errorData.error || errorMessage
            } catch {
              const errorText = await response.text()
              try {
                const errorJson = JSON.parse(errorText)
                errorMessage = errorJson.error || errorMessage
              } catch {
                errorMessage = errorText || errorMessage
              }
            }
            throw new Error(errorMessage)
          }
          return response.text()
        })
        .then(html => {
          // Create blob URL from HTML response
          const blob = new Blob([html], { type: 'text/html' })
          const url = URL.createObjectURL(blob)
          setPreviewUrl(url)
          setLoading(false)
        })
        .catch(err => {
          console.error('Preview generation error:', err)
          setError("Failed to generate preview")
          setLoading(false)
          if (onError) {
            onError("Failed to generate preview. Please check all fields and try again.")
          }
        })
    } else {
      // Use existing invoice ID - check if it exists first
      const checkUrl = `/api/invoices/${invoiceId}/pdf-preview`
      
      fetch(checkUrl)
        .then(response => {
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error("Invoice not found")
            }
            throw new Error(`Failed to load preview: ${response.status}`)
          }
          setPreviewUrl(checkUrl)
          setLoading(false)
        })
        .catch(err => {
          console.error('Preview load error:', err)
          setError(err.message || "Failed to load preview")
          setLoading(false)
          if (onError) {
            onError("Invoice not found. Please save the invoice first.")
          }
        })
    }
  }, [isOpen, invoiceId, previewData, onError])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleIframeLoad = () => {
    setLoading(false)
    
    // Check for errors in iframe content
    if (iframeRef.current?.contentWindow) {
      try {
        const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document
        const bodyText = iframeDoc.body?.textContent || ""
        
        if (bodyText.includes('"error"') || bodyText.includes('Invoice not found') || bodyText.includes('Failed to')) {
          setError("Failed to load preview")
          if (onError) {
            onError("Failed to load preview")
          }
        }
      } catch (e) {
        // Cross-origin or other error - assume it loaded fine
        // This is normal for blob URLs
      }
    }
  }

  const handleIframeError = () => {
    setLoading(false)
    setError("Failed to load preview")
    if (onError) {
      onError("Failed to load preview")
    }
  }

  const handleDownload = async () => {
    if (!canDownloadSaved) return
    try {
      setDownloadLoading(true)
      await downloadInvoiceHtmlDocument(invoiceId, invoiceNumber ?? null, businessId)
    } catch (e: any) {
      const msg = e?.message || "Download failed"
      setError(msg)
      if (onError) onError(msg)
    } finally {
      setDownloadLoading(false)
    }
  }

  if (!isOpen) return null

  if (error && error.includes("not found")) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Invoice Not Found</h3>
            <p className="text-gray-600 mb-6">Invoice not saved yet. Save first before previewing.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Invoice Preview</h2>
            <p className="text-sm text-gray-500 mt-1">Review your invoice</p>
            {isDraftPreview && (
              <p className="text-sm font-medium text-amber-700 bg-amber-100 mt-2 px-3 py-1.5 rounded inline-block">
                DRAFT PREVIEW – Not saved
              </p>
            )}
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
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading preview...</p>
              </div>
            </div>
          )}
          {previewUrl && (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title="Invoice Preview"
            />
          )}
          {error && !error.includes("not found") && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
              <div className="text-center">
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={() => {
                    setError("")
                    setLoading(true)
                    if (iframeRef.current) {
                      iframeRef.current.src = previewUrl + (previewUrl.includes('?') ? '&' : '?') + 't=' + Date.now()
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          {canDownloadSaved && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloadLoading || Boolean(error)}
              className="px-6 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {downloadLoading ? "Downloading…" : "Download"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

