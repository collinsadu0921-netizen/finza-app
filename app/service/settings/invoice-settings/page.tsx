"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ServiceInvoiceSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [formData, setFormData] = useState({
    invoice_prefix: "INV-",
    starting_number: 1,
    due_days_default: 30,
    default_payment_terms: "",
    default_footer_message: "",
    show_tax_breakdown: true,
    show_business_tin: true,
    bank_name: "",
    bank_account_name: "",
    bank_account_number: "",
    momo_provider: "" as "MTN" | "Vodafone" | "AirtelTigo" | "",
    momo_name: "",
    momo_number: "",
    due_date_reminders_enabled: false,
    due_date_reminder_days: 3,
  })

  useEffect(() => {
    loadInvoiceSettings()
  }, [])

  const loadInvoiceSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/invoice-settings")
      if (!response.ok) {
        throw new Error("Failed to load invoice settings")
      }

      const { settings } = await response.json()

      if (settings) {
        setFormData({
          invoice_prefix: settings.invoice_prefix || "INV-",
          starting_number: settings.starting_number || 1,
          due_days_default: settings.due_days_default || 30,
          default_payment_terms: settings.default_payment_terms || "",
          default_footer_message: settings.default_footer_message || "",
          show_tax_breakdown: settings.show_tax_breakdown !== false,
          show_business_tin: settings.show_business_tin !== false,
          bank_name: settings.bank_name || "",
          bank_account_name: settings.bank_account_name || "",
          bank_account_number: settings.bank_account_number || "",
          momo_provider: settings.momo_provider || "",
          momo_name: settings.momo_name || "",
          momo_number: settings.momo_number || "",
          due_date_reminders_enabled: settings.due_date_reminders_enabled || false,
          due_date_reminder_days: settings.due_date_reminder_days || 3,
        })
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load invoice settings")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    try {
      setSaving(true)

      const response = await fetch("/api/invoice-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to save invoice settings")
      }

      setSuccess("Invoice settings updated successfully!")
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save invoice settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Invoice Settings
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Configure default invoice settings and payment details
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Invoice Numbering */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Invoice Numbering</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Invoice Prefix
                </label>
                <input
                  type="text"
                  value={formData.invoice_prefix}
                  onChange={(e) => setFormData({ ...formData, invoice_prefix: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="INV-"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Prefix for invoice numbers (e.g., "INV-", "INV-GH-")
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Starting Number
                </label>
                <input
                  type="number"
                  value={formData.starting_number}
                  onChange={(e) => setFormData({ ...formData, starting_number: parseInt(e.target.value) || 1 })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  min="1"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  First invoice number (only used once to initialize)
                </p>
              </div>
            </div>
          </div>

          {/* Defaults */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Default Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Default Due Days
                </label>
                <input
                  type="number"
                  value={formData.due_days_default}
                  onChange={(e) => setFormData({ ...formData, due_days_default: parseInt(e.target.value) || 30 })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  min="1"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Number of days after issue date for payment due date
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Default Payment Terms
                </label>
                <textarea
                  value={formData.default_payment_terms}
                  onChange={(e) => setFormData({ ...formData, default_payment_terms: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g., Payment is due within 30 days of invoice date."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Default Footer Message
                </label>
                <textarea
                  value={formData.default_footer_message}
                  onChange={(e) => setFormData({ ...formData, default_footer_message: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g., Thank you for your business!"
                />
              </div>
            </div>
          </div>

          {/* Display Options */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Display Options</h2>
            <div className="space-y-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.show_tax_breakdown}
                  onChange={(e) => setFormData({ ...formData, show_tax_breakdown: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Show tax breakdown on invoices
                </span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.show_business_tin}
                  onChange={(e) => setFormData({ ...formData, show_business_tin: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Show business TIN on invoices
                </span>
              </label>
            </div>
          </div>

          {/* Due Date Reminders */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Due Date Reminders</h2>
            <div className="space-y-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.due_date_reminders_enabled}
                  onChange={(e) => setFormData({ ...formData, due_date_reminders_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable automatic due date reminders
                </span>
              </label>
              {formData.due_date_reminders_enabled && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Days Before Due Date
                  </label>
                  <input
                    type="number"
                    value={formData.due_date_reminder_days}
                    onChange={(e) => setFormData({ ...formData, due_date_reminder_days: parseInt(e.target.value) || 3 })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    min="1"
                    max="30"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Send reminder email X days before invoice due date (default: 3 days)
                  </p>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Reminders are sent automatically via email to customers with outstanding invoices. Each invoice receives only one reminder.
              </p>
            </div>
          </div>

          {/* Payment Details */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Payment Details (Ghana)</h2>

            {/* Bank Details */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">Bank Account</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., GCB Bank"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Account Name
                  </label>
                  <input
                    type="text"
                    value={formData.bank_account_name}
                    onChange={(e) => setFormData({ ...formData, bank_account_name: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Account holder name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Account Number
                  </label>
                  <input
                    type="text"
                    value={formData.bank_account_number}
                    onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Account number"
                  />
                </div>
              </div>
            </div>

            {/* Mobile Money Details */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">Mobile Money</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Provider
                  </label>
                  <select
                    value={formData.momo_provider}
                    onChange={(e) => setFormData({ ...formData, momo_provider: e.target.value as any })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select provider</option>
                    <option value="MTN">MTN</option>
                    <option value="Vodafone">Vodafone</option>
                    <option value="AirtelTigo">AirtelTigo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    MoMo Name
                  </label>
                  <input
                    type="text"
                    value={formData.momo_name}
                    onChange={(e) => setFormData({ ...formData, momo_name: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Name on MoMo account"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    MoMo Number
                  </label>
                  <input
                    type="tel"
                    value={formData.momo_number}
                    onChange={(e) => setFormData({ ...formData, momo_number: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="0XX XXX XXXX"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Invoice Settings"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
