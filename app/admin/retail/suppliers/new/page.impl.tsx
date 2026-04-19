"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  RetailBackofficeAlert,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

const SUPPLIER_STATUS_OPTIONS: MenuSelectOption[] = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
]

export default function NewSupplierPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"active" | "blocked">("active")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) {
      setError("Name is required")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          status,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create supplier")
      }

      const id = data.supplier?.id as string | undefined
      if (id) {
        router.push(`/retail/admin/suppliers/${id}`)
      } else {
        router.push("/retail/admin/suppliers")
      }
    } catch (err: any) {
      console.error("Error creating supplier:", err)
      setError(err.message || "Failed to create supplier")
    } finally {
      setLoading(false)
    }
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-xl">
        <RetailBackofficePageHeader
          eyebrow="Suppliers"
          title="New supplier"
          description="Start with the basics. After saving, you can add MoMo, bank details, terms, and notes on their profile."
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className={retailLabelClass}>
                Business name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={retailFieldClass}
                placeholder="Who you buy from"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="phone" className={retailLabelClass}>
                Phone
              </label>
              <input
                type="tel"
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={retailFieldClass}
                placeholder="Main phone"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="email" className={retailLabelClass}>
                Email (optional)
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={retailFieldClass}
                placeholder="Email address"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="status" className={retailLabelClass}>
                Status
              </label>
              <RetailMenuSelect
                id="status"
                value={status}
                onValueChange={(v) => setStatus(v as "active" | "blocked")}
                disabled={loading}
                options={SUPPLIER_STATUS_OPTIONS}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <RetailBackofficeButton
                variant="secondary"
                type="button"
                className="flex-1"
                onClick={() => router.push("/retail/admin/suppliers")}
                disabled={loading}
              >
                Cancel
              </RetailBackofficeButton>
              <RetailBackofficeButton variant="primary" type="submit" className="flex-1" disabled={loading}>
                {loading ? "Creating…" : "Create and open profile"}
              </RetailBackofficeButton>
            </div>
          </form>
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
