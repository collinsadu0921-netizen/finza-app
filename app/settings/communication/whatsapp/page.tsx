"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"
import {
  type WhatsAppTemplateType,
  TEMPLATE_VARIABLES,
} from "@/lib/communication/getBusinessWhatsAppTemplate"
import { renderWhatsAppTemplate } from "@/lib/communication/renderWhatsAppTemplate"

const MAX_LENGTH = 1000
const TABS: { id: WhatsAppTemplateType; label: string }[] = [
  { id: "invoice", label: "Invoice" },
  { id: "estimate", label: "Estimate" },
  { id: "order", label: "Order" },
]

const SAMPLE_VARIABLES: Record<WhatsAppTemplateType, Record<string, string>> = {
  invoice: {
    customer_name: "Valued Customer",
    invoice_number: "#INV-001",
    due_date: "15 March 2026",
    public_url: "https://app.example.com/invoice-public/abc123",
    pay_url: "https://app.example.com/invoice-public/abc123",
    business_name: "Our Business",
    total: "",
    currency: "",
  },
  estimate: {
    customer_name: "Valued Customer",
    estimate_number: "#EST-001",
    public_url: "https://app.example.com/estimate-public/xyz",
    business_name: "Our Business",
    total: "",
    currency: "",
    valid_until: "",
  },
  order: {
    customer_name: "Valued Customer",
    order_number: "ORD-ABC12345",
    public_url: "https://app.example.com/order-public/def",
    business_name: "Our Business",
    total: "",
    currency: "",
  },
}

export default function WhatsAppTemplatesPage() {
  const router = useRouter()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<WhatsAppTemplateType>("invoice")
  const [template, setTemplate] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const loadTemplate = useCallback(async (type: WhatsAppTemplateType) => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/settings/whatsapp-template?type=${type}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load template")
      }
      const data = await res.json()
      setTemplate(data.template ?? "")
    } catch (e: any) {
      setError(e?.message || "Failed to load template")
      setTemplate("")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplate(activeTab)
  }, [activeTab, loadTemplate])

  const handleSave = async () => {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/settings/whatsapp-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeTab, template }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed to save template")
      }
      toast.showToast("Template saved successfully.", "success")
    } catch (e: any) {
      setError(e?.message || "Failed to save template")
      toast.showToast(e?.message || "Failed to save template", "error")
    } finally {
      setSaving(false)
    }
  }

  const preview = template
    ? renderWhatsAppTemplate(template, SAMPLE_VARIABLES[activeTab])
    : ""

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent mb-2">
              WhatsApp Message Templates
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Prefilled text for <strong className="font-semibold text-gray-700 dark:text-gray-300">wa.me</strong> when you send from Finza. No WhatsApp Business API connection required.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 mb-6">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 border border-gray-200 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">Loading template...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Message template
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    {activeTab === "invoice"
                      ? "Use {{variable_name}} for placeholders. Required: {{invoice_number}} and {{public_url}}. Customer-facing sends should point to the public invoice link (same as {{public_url}}, e.g. /invoice-public/{public_token}). Optional {{pay_url}} remains for older templates—it is populated with that same public invoice URL, not a legacy raw pay link."
                      : activeTab === "estimate"
                        ? "Use {{variable_name}} for placeholders. Required: {{estimate_number}} and {{public_url}} (public estimate link)."
                        : "Use {{variable_name}} for placeholders. Required: {{order_number}} and {{public_url}} (public order link)."}
                  </p>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={14}
                    maxLength={MAX_LENGTH + 100}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:bg-gray-700 dark:text-white font-mono text-sm"
                    placeholder="Hello {{customer_name}}, ..."
                  />
                  <div className="mt-2 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{template.length} / {MAX_LENGTH} characters</span>
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving || template.length > MAX_LENGTH}
                  className="w-full sm:w-auto bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {saving ? "Saving..." : "Save template"}
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Available variables</h3>
                  {activeTab === "invoice" ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      <span className="font-mono">{`{{pay_url}}`}</span> uses the same URL as{" "}
                      <span className="font-mono">{`{{public_url}}`}</span> (the public invoice link). Prefer{" "}
                      <span className="font-mono">{`{{public_url}}`}</span> in new templates.
                    </p>
                  ) : null}
                  <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    {TEMPLATE_VARIABLES[activeTab].map((v) => (
                      <li key={v} className="font-mono">{`{{${v}}}`}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Live preview</h3>
                  <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-700 p-3 min-h-[120px]">
                    {preview || "Enter a template to see preview."}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
