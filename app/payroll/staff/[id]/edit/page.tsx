"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

type Staff = {
  id: string
  name: string
  position: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  basic_salary: number
  employment_type: string
  bank_name: string | null
  bank_account: string | null
  ssnit_number: string | null
  tin_number: string | null
  start_date: string
  status: string
}

export default function EditStaffPage() {
  const router = useRouter()
  const params = useParams()
  const staffId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [staff, setStaff] = useState<Staff | null>(null)

  const [formData, setFormData] = useState({
    name: "",
    position: "",
    phone: "",
    whatsapp_phone: "",
    email: "",
    basic_salary: "",
    employment_type: "full_time" as "full_time" | "part_time" | "casual",
    bank_name: "",
    bank_account: "",
    ssnit_number: "",
    tin_number: "",
    start_date: "",
    status: "active",
  })

  useEffect(() => {
    loadStaff()
  }, [staffId])

  const loadStaff = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/staff/${staffId}`)
      const data = await response.json()

      if (response.ok && data.staff) {
        setStaff(data.staff)
        setFormData({
          name: data.staff.name || "",
          position: data.staff.position || "",
          phone: data.staff.phone || "",
          whatsapp_phone: data.staff.whatsapp_phone || "",
          email: data.staff.email || "",
          basic_salary: data.staff.basic_salary?.toString() || "",
          employment_type: data.staff.employment_type || "full_time",
          bank_name: data.staff.bank_name || "",
          bank_account: data.staff.bank_account || "",
          ssnit_number: data.staff.ssnit_number || "",
          tin_number: data.staff.tin_number || "",
          start_date: data.staff.start_date || "",
          status: data.staff.status || "active",
        })
      } else {
        setError(data.error || "Failed to load staff")
      }
    } catch (err: any) {
      setError(err.message || "Failed to load staff")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setSaving(true)

    try {
      const response = await fetch(`/api/staff/${staffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          position: formData.position.trim() || null,
          phone: formData.phone.trim() || null,
          whatsapp_phone: formData.whatsapp_phone.trim() || null,
          email: formData.email.trim() || null,
          basic_salary: parseFloat(formData.basic_salary) || 0,
          employment_type: formData.employment_type,
          bank_name: formData.bank_name.trim() || null,
          bank_account: formData.bank_account.trim() || null,
          ssnit_number: formData.ssnit_number.trim() || null,
          tin_number: formData.tin_number.trim() || null,
          start_date: formData.start_date,
          status: formData.status,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess("Staff updated successfully!")
        setTimeout(() => {
          router.push(`/payroll/staff/${staffId}`)
        }, 1000)
      } else {
        setError(data.error || "Failed to update staff")
      }
    } catch (err: any) {
      setError(err.message || "Failed to update staff")
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

  if (!staff) {
    return (
      <div className="p-6">
        <p className="text-red-500">Staff not found</p>
        <button onClick={() => router.back()} className="mt-4 text-blue-600 hover:underline">
          ← Back
        </button>
      </div>
    )
  }

  return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <button
              onClick={() => router.push(`/payroll/staff/${staffId}`)}
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2"
            >
              ← Back to Staff Details
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Edit Staff</h1>
            <p className="text-gray-600 dark:text-gray-400">Update staff information</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg mb-4">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Position
                </label>
                <input
                  type="text"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  WhatsApp Phone
                </label>
                <input
                  type="tel"
                  value={formData.whatsapp_phone}
                  onChange={(e) => setFormData({ ...formData, whatsapp_phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Basic Salary (₵) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.basic_salary}
                  onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Employment Type
                </label>
                <select
                  value={formData.employment_type}
                  onChange={(e) => setFormData({ ...formData, employment_type: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="casual">Casual</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Bank Account
                </label>
                <input
                  type="text"
                  value={formData.bank_account}
                  onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SSNIT Number
                </label>
                <input
                  type="text"
                  value={formData.ssnit_number}
                  onChange={(e) => setFormData({ ...formData, ssnit_number: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  TIN Number
                </label>
                <input
                  type="text"
                  value={formData.tin_number}
                  onChange={(e) => setFormData({ ...formData, tin_number: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
            </div>

            <div className="flex gap-4 mt-6">
              <button
                type="button"
                onClick={() => router.push(`/payroll/staff/${staffId}`)}
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
  )
}

