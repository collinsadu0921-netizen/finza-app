"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"

type ReceiptSettings = {
  id?: string
  printer_type: "escpos" | "browser_print"
  printer_width: "58mm" | "80mm"
  auto_cut: boolean
  drawer_kick: boolean
  show_logo: boolean
  receipt_mode: "compact" | "full"
  footer_text: string
  show_qr_code: boolean
  qr_code_content: string
}

export default function ReceiptSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessId, setBusinessId] = useState("")
  const [settings, setSettings] = useState<ReceiptSettings>({
    printer_type: "browser_print",
    printer_width: "58mm",
    auto_cut: false,
    drawer_kick: false,
    show_logo: true,
    receipt_mode: "full",
    footer_text: "",
    show_qr_code: false,
    qr_code_content: "",
  })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setTableMissing(false)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Load existing settings
      const { data, error: fetchError } = await supabase
        .from("receipt_settings")
        .select("*")
        .eq("business_id", business.id)
        .maybeSingle()

      if (fetchError && fetchError.code !== "PGRST116") {
        // PGRST205 = table not in schema cache / table does not exist
        const isTableMissing =
          (fetchError as { code?: string }).code === "PGRST205" ||
          String((fetchError as { message?: string }).message ?? "").toLowerCase().includes("schema cache") ||
          String((fetchError as { message?: string }).message ?? "").toLowerCase().includes("could not find the table")
        if (isTableMissing) {
          setTableMissing(true)
          setError(
            "The receipt_settings table is missing. Run the database migration: supabase/migrations/024_receipt_settings.sql (and 299_receipt_settings_add_missing_columns.sql if needed), then reload the schema cache in Supabase Dashboard (Settings → API → Reload schema)."
          )
          setLoading(false)
          return
        }
        throw fetchError
      }

      if (data) {
        setSettings({
          printer_type: data.printer_type || "browser_print",
          printer_width: data.printer_width || "58mm",
          auto_cut: data.auto_cut || false,
          drawer_kick: data.drawer_kick || false,
          show_logo: data.show_logo !== undefined ? data.show_logo : true,
          receipt_mode: data.receipt_mode || "full",
          footer_text: data.footer_text || "",
          show_qr_code: data.show_qr_code || false,
          qr_code_content: data.qr_code_content || "",
        })
      }
    } catch (err: any) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : err != null
            ? String(err)
            : "Failed to load settings"
      const isTableMissing =
        (err && typeof err === "object" && (err as { code?: string }).code === "PGRST205") ||
        String(message).toLowerCase().includes("schema cache") ||
        String(message).toLowerCase().includes("could not find the table")
      if (isTableMissing) {
        setTableMissing(true)
        setError(
          "The receipt_settings table is missing. Run the database migration: supabase/migrations/024_receipt_settings.sql (and 299_receipt_settings_add_missing_columns.sql if needed), then reload the schema cache in Supabase Dashboard (Settings → API → Reload schema)."
        )
      } else {
        setError(message || "Failed to load settings")
      }
      console.error("Error loading settings:", message, err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!businessId) {
      setError("Business not found")
      return
    }

    setSaving(true)
    setError("")
    setSuccess(false)

    try {
      const { error: upsertError } = await supabase
        .from("receipt_settings")
        .upsert(
          {
            business_id: businessId,
            ...settings,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "business_id",
          }
        )

      if (upsertError) throw upsertError

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl font-bold mb-2">Receipt Settings</h1>
          <p className="text-gray-600">Configure thermal printer and receipt options</p>
          <p className="text-sm text-gray-500 mt-1">
            To create or manage cash registers (tills),{" "}
            <button
              type="button"
              onClick={() => router.push("/retail/admin/registers")}
              className="text-blue-600 hover:underline font-medium"
            >
              go to Manage Registers
            </button>
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
            {tableMissing && (
              <p className="mt-2 text-sm">
                From the project folder run: <code className="bg-red-100 px-1 rounded">npx supabase db push</code>
              </p>
            )}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            Settings saved successfully!
          </div>
        )}

        <div className="bg-white border rounded-lg p-6 space-y-6">
          {/* Printer Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Printer Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="browser_print"
                  checked={settings.printer_type === "browser_print"}
                  onChange={(e) =>
                    setSettings({ ...settings, printer_type: e.target.value as "browser_print" | "escpos" })
                  }
                  className="mr-2"
                />
                Browser Print (HTML)
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="escpos"
                  checked={settings.printer_type === "escpos"}
                  onChange={(e) =>
                    setSettings({ ...settings, printer_type: e.target.value as "browser_print" | "escpos" })
                  }
                  className="mr-2"
                />
                ESC/POS (Thermal Printer)
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              ESC/POS requires WebUSB/Web Serial API support
            </p>
          </div>

          {/* Printer Width */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Printer Width
            </label>
            <select
              value={settings.printer_width}
              onChange={(e) =>
                setSettings({ ...settings, printer_width: e.target.value as "58mm" | "80mm" })
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="58mm">58mm (Standard)</option>
              <option value="80mm">80mm (Wide)</option>
            </select>
          </div>

          {/* Receipt Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Receipt Mode
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="compact"
                  checked={settings.receipt_mode === "compact"}
                  onChange={(e) =>
                    setSettings({ ...settings, receipt_mode: e.target.value as "compact" | "full" })
                  }
                  className="mr-2"
                />
                Compact (One-line items)
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="full"
                  checked={settings.receipt_mode === "full"}
                  onChange={(e) =>
                    setSettings({ ...settings, receipt_mode: e.target.value as "compact" | "full" })
                  }
                  className="mr-2"
                />
                Full (Detailed items)
              </label>
            </div>
          </div>

          {/* ESC/POS Options */}
          {settings.printer_type === "escpos" && (
            <>
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.auto_cut}
                    onChange={(e) => setSettings({ ...settings, auto_cut: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Auto Cut Paper</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  Automatically cut paper after printing
                </p>
              </div>

              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.drawer_kick}
                    onChange={(e) => setSettings({ ...settings, drawer_kick: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Auto Open Cash Drawer</span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  Automatically open cash drawer after printing (ESC/POS command)
                </p>
              </div>
            </>
          )}

          {/* Logo */}
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.show_logo}
                onChange={(e) => setSettings({ ...settings, show_logo: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700">Show Business Logo</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              Display business logo at top of receipt (if uploaded in Business Settings)
            </p>
          </div>

          {/* QR Code */}
          <div>
            <label className="flex items-center mb-2">
              <input
                type="checkbox"
                checked={settings.show_qr_code}
                onChange={(e) => setSettings({ ...settings, show_qr_code: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700">Show QR Code on Receipt</span>
            </label>
            {settings.show_qr_code && (
              <div className="ml-6 mt-2">
                <label className="block text-xs text-gray-600 mb-1">
                  QR Code Content (URL, phone number, WhatsApp link, etc.)
                </label>
                <input
                  type="text"
                  value={settings.qr_code_content}
                  onChange={(e) => setSettings({ ...settings, qr_code_content: e.target.value })}
                  placeholder="https://example.com or 0551234567"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          {/* Footer Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Footer Text
            </label>
            <textarea
              value={settings.footer_text}
              onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
              placeholder="Thank you for shopping with us!&#10;No refunds after 48 hours.&#10;Call: 055 XXXX XXX"
              rows={4}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Multi-line text displayed at bottom of receipt. Use line breaks to separate lines.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t">
            <button
              onClick={handleSave}
              disabled={saving || tableMissing}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : tableMissing ? "Save unavailable (run migration)" : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}







