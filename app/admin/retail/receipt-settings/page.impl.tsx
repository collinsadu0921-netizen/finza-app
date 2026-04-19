"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { RetailMenuSelect, type MenuSelectOption } from "@/components/retail/RetailBackofficeUi"

const RECEIPT_PRINTER_WIDTH_OPTIONS: MenuSelectOption[] = [
  { value: "58mm", label: "58mm (Standard)" },
  { value: "80mm", label: "80mm (Wide)" },
]
import { retailPaths } from "@/lib/retail/routes"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

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
  const [canEditReceipt, setCanEditReceipt] = useState(true)

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

      const res = await fetch("/api/retail/receipt-settings", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        business_id?: string
        can_edit?: boolean
        settings?: Record<string, unknown> | null
      }

      if (!res.ok) {
        const msg = json.error || "Failed to load settings"
        const isTableMissing =
          String(msg).toLowerCase().includes("schema cache") ||
          String(msg).toLowerCase().includes("could not find the table") ||
          String(msg).toLowerCase().includes("receipt_settings")
        if (isTableMissing) {
          setTableMissing(true)
          setError(
            "The receipt_settings table is missing. Run the database migration: supabase/migrations/024_receipt_settings.sql (and 299_receipt_settings_add_missing_columns.sql if needed), then reload the schema cache in Supabase Dashboard (Settings → API → Reload schema)."
          )
        } else {
          setError(msg)
        }
        setLoading(false)
        return
      }

      if (json.business_id) setBusinessId(json.business_id)
      setCanEditReceipt(json.can_edit !== false)

      const data = json.settings
      if (data) {
        setSettings({
          printer_type: (data.printer_type as ReceiptSettings["printer_type"]) || "browser_print",
          printer_width: (data.printer_width as ReceiptSettings["printer_width"]) || "58mm",
          auto_cut: Boolean(data.auto_cut),
          drawer_kick: Boolean(data.drawer_kick),
          show_logo: data.show_logo !== undefined ? Boolean(data.show_logo) : true,
          receipt_mode: (data.receipt_mode as ReceiptSettings["receipt_mode"]) || "full",
          footer_text: String(data.footer_text || ""),
          show_qr_code: Boolean(data.show_qr_code),
          qr_code_content: String(data.qr_code_content || ""),
        })
      }
    } catch (err: any) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : err != null
            ? String(err)
            : "Failed to load settings"
      setError(message || "Failed to load settings")
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
      const res = await fetch("/api/retail/receipt-settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || "Failed to save settings")
      }

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
      <div className={RS.outer}>
        <div className={RS.container}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.outer}>
      <div className={RS.container}>
        <div className={RS.headerBlock}>
          <button type="button" onClick={() => router.push("/retail/dashboard")} className={RS.backLink}>
            ← Back to Dashboard
          </button>
          <h1 className={RS.title}>Receipts & printer</h1>
          <p className={RS.subtitle}>Thermal or browser printing, receipt layout, and footer text for POS receipts.</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Manage tills in{" "}
            <button type="button" onClick={() => router.push(retailPaths.adminRegisters)} className={RS.linkInline}>
              Registers
            </button>
            .
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
            {tableMissing && (
              <p className="mt-2 text-sm">
                From the project folder run: <code className="rounded bg-red-100 px-1 dark:bg-red-900/50">npx supabase db push</code>
              </p>
            )}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
            Settings saved.
          </div>
        )}

        {!canEditReceipt && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100 mb-4">
            <span className="font-semibold">View only.</span> Only the business owner or an admin can change receipt and
            printer settings. You can still review the options below.
          </div>
        )}

        <fieldset disabled={!canEditReceipt} className={`${RS.formSectionCard} space-y-6`}>
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
            <RetailMenuSelect
              value={settings.printer_width}
              onValueChange={(v) =>
                setSettings({ ...settings, printer_width: v as "58mm" | "80mm" })
              }
              options={RECEIPT_PRINTER_WIDTH_OPTIONS}
            />
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
              Show logo on receipt when a URL is set: store logo (Store settings) takes priority, otherwise the business logo from Business Profile.
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
        </fieldset>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:justify-end">
          <button
            onClick={handleSave}
            type="button"
            disabled={saving || tableMissing || !canEditReceipt}
            title={!canEditReceipt ? "Only business owner or admin can save receipt settings." : undefined}
            className={`${RS.primaryButton} sm:min-w-[9rem] disabled:cursor-not-allowed`}
          >
            {saving
              ? "Saving…"
              : tableMissing
                ? "Save unavailable"
                : !canEditReceipt
                  ? "View only"
                  : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  )
}







