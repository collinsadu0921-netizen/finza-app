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
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [businessDisplayName, setBusinessDisplayName] = useState("")

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
          drawer_kick: false,
          show_logo: data.show_logo !== undefined ? Boolean(data.show_logo) : true,
          receipt_mode: (data.receipt_mode as ReceiptSettings["receipt_mode"]) || "full",
          footer_text: String(data.footer_text || ""),
          show_qr_code: Boolean(data.show_qr_code),
          qr_code_content: String(data.qr_code_content || ""),
        })
      }

      // Business-scoped logo/name for preview (same tenant as receipt_settings).
      try {
        const profileRes = await fetch("/api/business/profile", { credentials: "include" })
        const profileJson = (await profileRes.json().catch(() => ({}))) as {
          business?: {
            name?: string | null
            trading_name?: string | null
            legal_name?: string | null
            logo_url?: string | null
          }
        }
        const b = profileJson.business
        if (b) {
          setBusinessDisplayName(
            (b.trading_name || b.legal_name || b.name || "").trim()
          )
          setLogoPreviewUrl(b.logo_url?.trim() || null)
        }
      } catch {
        /* preview is optional */
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
        body: JSON.stringify({ settings: { ...settings, drawer_kick: false } }),
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
          <p className={RS.subtitle}>
            Configure how this business’s customer receipts look: printer path, logo, layout, and your own footer.
            Company name, address, and contact come from{" "}
            <button
              type="button"
              onClick={() => router.push(retailPaths.settingsBusinessProfile)}
              className={RS.linkInline}
            >
              Business Profile
            </button>
            .
          </p>
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
              Browser Print uses the Windows printer driver (for example XP-80 USB). ESC/POS sends raw commands
              over Web Serial in Chrome/Edge — only if the printer appears as a COM port. The XP-80 USB driver
              does not receive ESC/POS from the browser.
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

            </>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Cash drawer (Windows printer driver)</p>
            <p className="mt-1">
              Finza does not connect to or pulse the cash drawer. The XP-80 / BillPoint T80E Windows driver opens
              the drawer after a receipt prints. On the POS terminal:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Open Settings → Bluetooth &amp; devices → Printers &amp; scanners → XP-80 (or BillPoint T80E).</li>
              <li>Printer properties → Device Settings (or Cash Drawer / Peripheral).</li>
              <li>Set cash drawer to open after printing, usually Pin 2 (or Pin 5 if the kick cable uses that pin).</li>
              <li>Apply, then print a receipt. The driver may open the drawer for cash, card, MoMo, or reprints.</li>
            </ol>
            <p className="mt-2">
              Customer amount display: on the POS screen tap <span className="font-semibold">Display off</span> then
              <span className="font-semibold"> Connect customer display</span> and choose this terminal’s display COM
              port (often COM2 here; other tills may differ). It is an 8-digit numeric amount display, not a second
              monitor. Serial settings: 9600, 8 data bits, no parity, 1 stop bit, no flow control.
            </p>
          </div>

          {settings.printer_type === "browser_print" && settings.printer_width === "58mm" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">Linux CUPS / POS58 (ZJ-58)</p>
              <p className="mt-1">
                Prefer the ZJiang ZJ-58 driver (
                <span className="font-mono">/usr/share/cups/model/zjiang/zj58.ppd</span>
                ). In Chrome use paper size <span className="font-semibold">58 × 3276 mm</span>, margins none,
                headers/footers off, scale <span className="font-semibold">100%</span>. Finza’s 58mm Browser Print
                layout targets ~48mm printable width with tear-feed after the footer — do not use 80% scale.
              </p>
            </div>
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
              <span className="text-sm font-medium text-gray-700">Show business logo</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              Uses this business’s logo from Business Profile (store logo wins when set). Finza never substitutes its
              own logo.{" "}
              <button
                type="button"
                onClick={() => router.push(retailPaths.settingsBusinessProfile)}
                className="font-semibold text-blue-700 underline"
              >
                Edit logo &amp; contact details
              </button>
            </p>
            <div className="ml-6 mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Logo preview</p>
              {settings.show_logo && logoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreviewUrl}
                  alt=""
                  className="mt-2 max-h-16 max-w-[180px] object-contain"
                />
              ) : (
                <p className="mt-2 text-sm font-bold text-slate-900">
                  {businessDisplayName || "Business name"}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-600">
                {settings.printer_type === "escpos"
                  ? "ESC/POS serial path: logo image is not printed — receipt shows the business name in text only."
                  : "Windows / browser print: logo prints when a URL is available and this option is on."}
              </p>
            </div>
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
            <p className="text-xs text-gray-500 ml-6 mb-2">
              Sale receipts encode the sale id for Sales History lookup. Optional override below is only used when a
              sale id is unavailable.
            </p>
            {settings.show_qr_code && (
              <div className="ml-6 mt-2">
                <label className="block text-xs text-gray-600 mb-1">
                  Optional QR fallback content (advanced)
                </label>
                <input
                  type="text"
                  value={settings.qr_code_content}
                  onChange={(e) => setSettings({ ...settings, qr_code_content: e.target.value })}
                  placeholder="Leave blank for normal sale QR"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          {/* Footer Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Receipt footer (optional)
            </label>
            <textarea
              value={settings.footer_text}
              onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
              placeholder="Write your own footer — e.g. keep this receipt, or your returns wording. Leave blank for no footer."
              rows={4}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Tenant-authored only. Finza does not prefill returns policy, phone numbers, or a signature. Empty =
              no footer line on the receipt.
            </p>
            {settings.footer_text.trim() ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Footer preview ({settings.printer_width})
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-slate-800">
                  {settings.footer_text.trim()}
                </pre>
              </div>
            ) : null}
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







