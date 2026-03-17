"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"

export default function ReminderSettingsPage() {
  const router = useRouter()
  const currencySymbol = ""
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [formData, setFormData] = useState({
    overdue_reminders_enabled: false,
    email_reminders_enabled: true,
    reminder_frequency_days: [3, 7, 14] as number[],
    reminder_interval_days: 7,
    reminder_message_template: "",
    email_reminder_template: "",
  })

  const [customDays, setCustomDays] = useState("")

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reminders/settings")
      if (!response.ok) {
        throw new Error("Failed to load reminder settings")
      }

      const { settings } = await response.json()

      if (settings) {
        setFormData({
          overdue_reminders_enabled: settings.overdue_reminders_enabled || false,
          email_reminders_enabled: settings.email_reminders_enabled !== undefined ? settings.email_reminders_enabled : true,
          reminder_frequency_days: settings.reminder_frequency_days || [3, 7, 14],
          reminder_interval_days: settings.reminder_interval_days || 7,
          reminder_message_template: settings.reminder_message_template || "",
          email_reminder_template: settings.email_reminder_template || "",
        })
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load reminder settings")
      setLoading(false)
    }
  }

  const handleAddCustomDay = () => {
    const day = parseInt(customDays)
    if (day > 0 && !formData.reminder_frequency_days.includes(day)) {
      setFormData({
        ...formData,
        reminder_frequency_days: [...formData.reminder_frequency_days, day].sort((a, b) => a - b),
      })
      setCustomDays("")
    }
  }

  const handleRemoveDay = (day: number) => {
    setFormData({
      ...formData,
      reminder_frequency_days: formData.reminder_frequency_days.filter((d) => d !== day),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    try {
      setSaving(true)

      const response = await fetch("/api/reminders/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to save reminder settings")
      }

      setSuccess("Reminder settings updated successfully!")
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save reminder settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
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
              Overdue Reminder Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Configure automatic email and WhatsApp reminders for overdue invoices
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
            {/* Enable Reminders */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.overdue_reminders_enabled}
                  onChange={(e) => setFormData({ ...formData, overdue_reminders_enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable automatic overdue reminders
                </span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 ml-6">
                When enabled, customers will receive automated reminders for overdue invoices
              </p>
            </div>

            {/* Reminder Frequency */}
            {formData.overdue_reminders_enabled && (
              <>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Reminder Frequency</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Send reminders when invoices are overdue by these many days:
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {formData.reminder_frequency_days.map((day) => (
                      <span
                        key={day}
                        className="inline-flex items-center gap-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium"
                      >
                        {day} days
                        <button
                          type="button"
                          onClick={() => handleRemoveDay(day)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder="Add custom days"
                      min="1"
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomDay}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Email Reminders Section */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <div className="mb-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.email_reminders_enabled}
                        onChange={(e) => setFormData({ ...formData, email_reminders_enabled: e.target.checked })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        Enable automated email reminders
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 ml-6">
                      Send automatic email reminders to customers for overdue invoices
                    </p>
                  </div>

                  {formData.email_reminders_enabled && (
                    <>
                      {/* Reminder Interval */}
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Reminder Interval (days)
                        </label>
                        <input
                          type="number"
                          value={formData.reminder_interval_days}
                          onChange={(e) => setFormData({ ...formData, reminder_interval_days: parseInt(e.target.value) || 7 })}
                          min="1"
                          max="30"
                          className="border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          How often to send reminder emails (default: 7 days). Reminders will be sent every N days while invoice remains overdue.
                        </p>
                      </div>

                      {/* Email Template */}
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Email Reminder Template
                        </label>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                          Customize the email sent to customers. Use placeholders: {"{{customer_name}}"}, {"{{invoice_number}}"}, {"{{outstanding_amount}}"}, {"{{due_date}}"}, {"{{invoice_url}}"}
                        </p>
                        <textarea
                          value={formData.email_reminder_template}
                          onChange={(e) => setFormData({ ...formData, email_reminder_template: e.target.value })}
                          rows={8}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white font-mono text-sm"
                          placeholder={`Dear {{customer_name}},\n\nThis is a reminder that invoice {{invoice_number}} is overdue.\n\nOutstanding Amount: ${currencySymbol || "{{currency_symbol}}"}{{outstanding_amount}}\nDue Date: {{due_date}}\n\nPlease make payment at your earliest convenience.\n\nView Invoice: {{invoice_url}}\n\nThank you for your business.`}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                          Leave empty to use default template
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* WhatsApp Message Template */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">WhatsApp Message Template</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Customize the WhatsApp message sent to customers. Use placeholders: [CustomerName], [InvoiceNumber], [Amount], [Link]
                  </p>
                  <textarea
                    value={formData.reminder_message_template}
                    onChange={(e) => setFormData({ ...formData, reminder_message_template: e.target.value })}
                    rows={6}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder={`Hello [CustomerName], Invoice [InvoiceNumber] is overdue.&#10;&#10;Amount due: ${currencySymbol || "[CurrencySymbol]"}[Amount].&#10;&#10;Please make payment at your earliest convenience.&#10;&#10;Link: [Link]`}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Leave empty to use default template
                  </p>
                </div>
              </>
            )}

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
                  "Save Settings"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}

