"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeSectionTitle,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
  RetailBackofficeSubtle,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"
import {
  SUPPLIER_MOMO_NETWORK_HINTS,
  SUPPLIER_PAYMENT_PREFERENCES,
  SUPPLIER_PAYMENT_TERMS_TYPES,
  supplierPaymentPreferenceLabel,
  supplierPaymentTermsLabel,
} from "@/lib/retail/supplierRetailFields"

type SupplierRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: "active" | "blocked"
  created_at?: string
  contact_person?: string | null
  whatsapp_phone?: string | null
  location_line?: string | null
  payment_preference?: string | null
  payment_terms_type?: string | null
  payment_terms_custom?: string | null
  notes?: string | null
  momo_number?: string | null
  momo_network?: string | null
  bank_account_name?: string | null
  bank_name?: string | null
  bank_account_number?: string | null
  tax_id?: string | null
  lead_time_days?: number | null
  regular_products_note?: string | null
}

function trimOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function statusTone(s: string): "success" | "danger" {
  return s === "active" ? "success" : "danger"
}

const SUPPLIER_STATUS_OPTIONS: MenuSelectOption[] = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
]

export default function RetailSupplierDetailPage() {
  const params = useParams()
  const router = useRouter()
  const supplierId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [supplier, setSupplier] = useState<SupplierRow | null>(null)
  const [editing, setEditing] = useState(false)

  const [name, setName] = useState("")
  const [contactPerson, setContactPerson] = useState("")
  const [phone, setPhone] = useState("")
  const [whatsappPhone, setWhatsappPhone] = useState("")
  const [email, setEmail] = useState("")
  const [locationLine, setLocationLine] = useState("")
  const [paymentPreference, setPaymentPreference] = useState<string>("")
  const [paymentTermsType, setPaymentTermsType] = useState<string>("")
  const [paymentTermsCustom, setPaymentTermsCustom] = useState("")
  const [momoNumber, setMomoNumber] = useState("")
  const [momoNetwork, setMomoNetwork] = useState("")
  const [bankAccountName, setBankAccountName] = useState("")
  const [bankName, setBankName] = useState("")
  const [bankAccountNumber, setBankAccountNumber] = useState("")
  const [taxId, setTaxId] = useState("")
  const [leadTimeDays, setLeadTimeDays] = useState<string>("")
  const [regularProductsNote, setRegularProductsNote] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState<"active" | "blocked">("active")

  const supplierPaymentPreferenceOptions = useMemo(
    () =>
      [{ value: "", label: "—" }].concat(
        SUPPLIER_PAYMENT_PREFERENCES.map((p) => ({ value: p, label: supplierPaymentPreferenceLabel(p) })),
      ),
    [],
  )

  const supplierPaymentTermsOptions = useMemo(
    () =>
      [{ value: "", label: "—" }].concat(
        SUPPLIER_PAYMENT_TERMS_TYPES.map((t) => ({ value: t, label: supplierPaymentTermsLabel(t) })),
      ),
    [],
  )

  const hydrateFrom = useCallback((s: SupplierRow) => {
    setName(s.name || "")
    setContactPerson(s.contact_person ?? "")
    setPhone(s.phone ?? "")
    setWhatsappPhone(s.whatsapp_phone ?? "")
    setEmail(s.email ?? "")
    setLocationLine(s.location_line ?? "")
    setPaymentPreference(s.payment_preference ?? "")
    setPaymentTermsType(s.payment_terms_type ?? "")
    setPaymentTermsCustom(s.payment_terms_custom ?? "")
    setMomoNumber(s.momo_number ?? "")
    setMomoNetwork(s.momo_network ?? "")
    setBankAccountName(s.bank_account_name ?? "")
    setBankName(s.bank_name ?? "")
    setBankAccountNumber(s.bank_account_number ?? "")
    setTaxId(s.tax_id ?? "")
    setLeadTimeDays(s.lead_time_days != null ? String(s.lead_time_days) : "")
    setRegularProductsNote(s.regular_products_note ?? "")
    setNotes(s.notes ?? "")
    setStatus(s.status === "blocked" ? "blocked" : "active")
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      const res = await fetch(`/api/suppliers/${supplierId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Supplier not found")
      const s = data.supplier as SupplierRow
      setSupplier(s)
      hydrateFrom(s)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load supplier")
      setSupplier(null)
    } finally {
      setLoading(false)
    }
  }, [supplierId, hydrateFrom])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Business name is required")
      return
    }
    setSaving(true)
    setError("")
    try {
      const leadParsed = leadTimeDays.trim() === "" ? null : Number.parseInt(leadTimeDays, 10)
      const body: Record<string, unknown> = {
        name: name.trim(),
        contact_person: trimOrNull(contactPerson),
        phone: trimOrNull(phone),
        whatsapp_phone: trimOrNull(whatsappPhone),
        email: trimOrNull(email),
        location_line: trimOrNull(locationLine),
        payment_preference: paymentPreference ? paymentPreference : null,
        payment_terms_type: paymentTermsType ? paymentTermsType : null,
        payment_terms_custom: trimOrNull(paymentTermsCustom),
        momo_number: trimOrNull(momoNumber),
        momo_network: trimOrNull(momoNetwork),
        bank_account_name: trimOrNull(bankAccountName),
        bank_name: trimOrNull(bankName),
        bank_account_number: trimOrNull(bankAccountNumber),
        tax_id: trimOrNull(taxId),
        lead_time_days:
          leadParsed === null || Number.isNaN(leadParsed) ? null : leadParsed,
        regular_products_note: trimOrNull(regularProductsNote),
        notes: trimOrNull(notes),
        status,
      }
      const res = await fetch(`/api/suppliers/${supplierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not save")
      const s = data.supplier as SupplierRow
      setSupplier(s)
      hydrateFrom(s)
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-3xl">
          <RetailBackofficeSkeleton rows={6} />
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (error && !supplier) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-3xl">
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
          <RetailBackofficeButton variant="secondary" type="button" onClick={() => router.push("/retail/admin/suppliers")}>
            Back to suppliers
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (!supplier) return null

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-3xl">
        <button
          type="button"
          onClick={() => router.push("/retail/admin/suppliers")}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          <span className="text-slate-400" aria-hidden>
            ←
          </span>
          Suppliers
        </button>

        <RetailBackofficePageHeader
          eyebrow="Suppliers"
          title={supplier.name}
          description="Contact, location, and how you usually pay them. Keep it practical — no heavy procurement steps."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/retail/admin/purchase-orders/new?supplier_id=${encodeURIComponent(supplier.id)}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400"
              >
                New PO
              </Link>
              {editing ? (
                <>
                  <RetailBackofficeButton
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      hydrateFrom(supplier)
                      setEditing(false)
                      setError("")
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </RetailBackofficeButton>
                  <RetailBackofficeButton variant="primary" type="button" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </RetailBackofficeButton>
                </>
              ) : (
                <RetailBackofficeButton variant="primary" type="button" onClick={() => setEditing(true)}>
                  Edit details
                </RetailBackofficeButton>
              )}
            </div>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <RetailBackofficeBadge tone={statusTone(supplier.status)}>
            {supplier.status === "active" ? "Active" : "Blocked"}
          </RetailBackofficeBadge>
          {!editing ? (
            <RetailBackofficeSubtle>
              Payment: {supplierPaymentPreferenceLabel(supplier.payment_preference ?? undefined)} · Terms:{" "}
              {supplierPaymentTermsLabel(
                supplier.payment_terms_type ?? undefined,
                supplier.payment_terms_custom
              )}
            </RetailBackofficeSubtle>
          ) : null}
        </div>

        {!editing ? (
          <div className="space-y-6">
            <RetailBackofficeCard>
              <RetailBackofficeCardTitle>Contact</RetailBackofficeCardTitle>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className={retailLabelClass}>Contact person</dt>
                  <dd className="text-slate-900">{supplier.contact_person?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Phone</dt>
                  <dd className="text-slate-900">{supplier.phone || "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>WhatsApp</dt>
                  <dd className="text-slate-900">{supplier.whatsapp_phone || "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Email</dt>
                  <dd className="text-slate-900">{supplier.email || "—"}</dd>
                </div>
              </dl>
            </RetailBackofficeCard>

            <RetailBackofficeCard>
              <RetailBackofficeCardTitle>Location</RetailBackofficeCardTitle>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{supplier.location_line?.trim() || "—"}</p>
            </RetailBackofficeCard>

            <RetailBackofficeCard>
              <RetailBackofficeCardTitle>Payments</RetailBackofficeCardTitle>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className={retailLabelClass}>Preference</dt>
                  <dd className="text-slate-900">{supplierPaymentPreferenceLabel(supplier.payment_preference ?? undefined)}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Terms</dt>
                  <dd className="text-slate-900">
                    {supplierPaymentTermsLabel(
                      supplier.payment_terms_type ?? undefined,
                      supplier.payment_terms_custom
                    )}
                  </dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>MoMo</dt>
                  <dd className="text-slate-900">
                    {[supplier.momo_number, supplier.momo_network].filter(Boolean).join(" · ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Bank</dt>
                  <dd className="text-slate-900">
                    {supplier.bank_name || supplier.bank_account_name || supplier.bank_account_number
                      ? [supplier.bank_name, supplier.bank_account_name, supplier.bank_account_number]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </dd>
                </div>
              </dl>
            </RetailBackofficeCard>

            <RetailBackofficeCard>
              <RetailBackofficeCardTitle>Other</RetailBackofficeCardTitle>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className={retailLabelClass}>Tax ID / TIN</dt>
                  <dd className="text-slate-900">{supplier.tax_id || "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Typical lead time (days)</dt>
                  <dd className="text-slate-900">{supplier.lead_time_days != null ? supplier.lead_time_days : "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Usually supplies</dt>
                  <dd className="whitespace-pre-wrap text-slate-900">{supplier.regular_products_note?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className={retailLabelClass}>Notes</dt>
                  <dd className="whitespace-pre-wrap text-slate-900">{supplier.notes?.trim() || "—"}</dd>
                </div>
              </dl>
            </RetailBackofficeCard>
          </div>
        ) : (
          <RetailBackofficeCard>
            <RetailBackofficeSectionTitle>Edit supplier</RetailBackofficeSectionTitle>

            <div className="mt-6 space-y-5">
              <div>
                <label className={retailLabelClass}>Business name *</label>
                <input className={retailFieldClass} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className={retailLabelClass}>Contact person</label>
                <input
                  className={retailFieldClass}
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="Who you usually speak to"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>Phone</label>
                  <input className={retailFieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className={retailLabelClass}>WhatsApp</label>
                  <input className={retailFieldClass} value={whatsappPhone} onChange={(e) => setWhatsappPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={retailLabelClass}>Email (optional)</label>
                <input type="email" className={retailFieldClass} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className={retailLabelClass}>Location / area / landmark</label>
                <textarea
                  className={retailFieldClass}
                  rows={3}
                  value={locationLine}
                  onChange={(e) => setLocationLine(e.target.value)}
                  placeholder="e.g. Near Kejetia, Kumasi"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>Payment preference</label>
                  <RetailMenuSelect
                    value={paymentPreference}
                    onValueChange={setPaymentPreference}
                    options={supplierPaymentPreferenceOptions}
                  />
                </div>
                <div>
                  <label className={retailLabelClass}>Payment terms</label>
                  <RetailMenuSelect
                    value={paymentTermsType}
                    onValueChange={setPaymentTermsType}
                    options={supplierPaymentTermsOptions}
                  />
                </div>
              </div>
              {paymentTermsType === "custom" ? (
                <div>
                  <label className={retailLabelClass}>Custom terms (e.g. 45 days, end of month)</label>
                  <input className={retailFieldClass} value={paymentTermsCustom} onChange={(e) => setPaymentTermsCustom(e.target.value)} />
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>MoMo number</label>
                  <input className={retailFieldClass} value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} />
                </div>
                <div>
                  <label className={retailLabelClass}>MoMo network</label>
                  <input
                    className={retailFieldClass}
                    value={momoNetwork}
                    onChange={(e) => setMomoNetwork(e.target.value)}
                    placeholder={SUPPLIER_MOMO_NETWORK_HINTS.join(", ")}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>Bank name</label>
                  <input className={retailFieldClass} value={bankName} onChange={(e) => setBankName(e.target.value)} />
                </div>
                <div>
                  <label className={retailLabelClass}>Account name</label>
                  <input className={retailFieldClass} value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={retailLabelClass}>Account number</label>
                <input className={retailFieldClass} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={retailLabelClass}>Tax ID / TIN</label>
                  <input className={retailFieldClass} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
                </div>
                <div>
                  <label className={retailLabelClass}>Lead time (days)</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    className={retailFieldClass}
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div>
                <label className={retailLabelClass}>Usually supplies (informal)</label>
                <textarea
                  className={retailFieldClass}
                  rows={2}
                  value={regularProductsNote}
                  onChange={(e) => setRegularProductsNote(e.target.value)}
                  placeholder="e.g. drinks, tissue, rice"
                />
              </div>
              <div>
                <label className={retailLabelClass}>Notes</label>
                <textarea className={retailFieldClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div>
                <label className={retailLabelClass}>Status</label>
                <RetailMenuSelect
                  value={status}
                  onValueChange={(v) => setStatus(v as "active" | "blocked")}
                  options={SUPPLIER_STATUS_OPTIONS}
                />
              </div>
            </div>
          </RetailBackofficeCard>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
