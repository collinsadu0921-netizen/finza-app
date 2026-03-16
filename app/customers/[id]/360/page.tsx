"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { formatMoney } from "@/lib/money"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  tags?: string[]
  internal_notes?: string | null
}

type Activity = {
  type: "invoice" | "estimate" | "order" | "payment" | "credit_note"
  id: string
  number: string | null
  date: string
  amount: number
  status: string | null
  entity: any
}

type Note = {
  id: string
  note: string
  created_at: string
  created_by: string | null
}

type Summary = {
  totalInvoiced: number
  totalPaid: number
  totalCredits: number
  totalOutstanding: number
  overdueAmount: number
  invoiceCount: number
  estimateCount: number
  orderCount: number
  paymentCount: number
  creditNoteCount: number
}

export default function Customer360Page() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string
  const { currencyCode, currencySymbol } = useBusinessCurrency()

  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState("")
  const [newNote, setNewNote] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")

  useEffect(() => {
    loadCustomer360()
  }, [customerId])

  const loadCustomer360 = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/customers/${customerId}/360`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load customer 360")
      }

      const data = await response.json()
      setCustomer(data.customer)
      setActivities(data.activities || [])
      setNotes(data.notes || [])
      setSummary(data.summary)
      setTags(data.customer.tags || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load customer 360")
      setLoading(false)
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return

    try {
      setSavingNote(true)
      const response = await fetch(`/api/customers/${customerId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: newNote }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to add note")
      }

      const { note } = await response.json()
      setNotes([note, ...notes])
      setNewNote("")
      setSavingNote(false)
    } catch (err: any) {
      setError(err.message || "Failed to add note")
      setSavingNote(false)
    }
  }

  const handleAddTag = () => {
    if (!newTag.trim() || tags.includes(newTag.trim())) return
    const updatedTags = [...tags, newTag.trim()]
    setTags(updatedTags)
    setNewTag("")
    handleSaveTags(updatedTags)
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const updatedTags = tags.filter((t) => t !== tagToRemove)
    setTags(updatedTags)
    handleSaveTags(updatedTags)
  }

  const handleSaveTags = async (tagsToSave: string[]) => {
    try {
      const response = await fetch(`/api/customers/${customerId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagsToSave }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to update tags")
      }
    } catch (err: any) {
      setError(err.message || "Failed to update tags")
      // Revert tags on error
      loadCustomer360()
    }
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "invoice":
        return "📋"
      case "estimate":
        return "📄"
      case "order":
        return "📦"
      case "payment":
        return "💵"
      case "credit_note":
        return "📝"
      default:
        return "📌"
    }
  }

  const getActivityLink = (activity: Activity) => {
    switch (activity.type) {
      case "invoice":
        return `/invoices/${activity.id}/view`
      case "estimate":
        return `/estimates/${activity.id}/view`
      case "order":
        return `/orders/${activity.id}/view`
      case "payment":
        return `/service/payments`
      case "credit_note":
        return `/credit-notes/${activity.id}/view`
      default:
        return "#"
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading customer 360...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error && !customer) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Customer 360: {customer?.name}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Complete view of customer relationship
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => router.push(`/customers/${customerId}/statement`)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                View Statement
              </button>
              <button
                onClick={() => router.push(`/customers/${customerId}`)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Back to Profile
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Financial Summary */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
              <div className="text-blue-900 dark:text-blue-300 font-semibold text-sm mb-1">
                Total Invoiced
              </div>
              <div className="text-blue-900 dark:text-blue-300 font-bold text-xl">
                {formatMoney(summary.totalInvoiced, currencyCode)}
              </div>
              <div className="text-blue-700 dark:text-blue-400 text-xs mt-1">
                {summary.invoiceCount} invoice{summary.invoiceCount !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <div className="text-green-900 dark:text-green-300 font-semibold text-sm mb-1">
                Total Paid
              </div>
              <div className="text-green-900 dark:text-green-300 font-bold text-xl">
                {formatMoney(summary.totalPaid, currencyCode)}
              </div>
              <div className="text-green-700 dark:text-green-400 text-xs mt-1">
                {summary.paymentCount} payment{summary.paymentCount !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-700 rounded-xl p-4">
              <div className="text-orange-900 dark:text-orange-300 font-semibold text-sm mb-1">
                Outstanding
              </div>
              <div className="text-orange-900 dark:text-orange-300 font-bold text-xl">
                {formatMoney(summary.totalOutstanding, currencyCode)}
              </div>
              {summary.totalCredits > 0 && (
                <div className="text-orange-700 dark:text-orange-400 text-xs mt-1">
                  {formatMoney(summary.totalCredits, currencyCode)} in credits
                </div>
              )}
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
              <div className="text-red-900 dark:text-red-300 font-semibold text-sm mb-1">
                Overdue
              </div>
              <div className="text-red-900 dark:text-red-300 font-bold text-xl">
                {formatMoney(summary.overdueAmount, currencyCode)}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Customer Info & Tags */}
          <div className="space-y-6">
            {/* Customer Info */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Customer Information
              </h2>
              <div className="space-y-2">
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Email:</span>
                  <p className="text-gray-900 dark:text-white">{customer?.email || "N/A"}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Phone:</span>
                  <p className="text-gray-900 dark:text-white">{customer?.phone || "N/A"}</p>
                </div>
                {customer?.internal_notes && (
                  <div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Internal Notes:</span>
                    <p className="text-gray-900 dark:text-white text-sm mt-1">
                      {customer.internal_notes}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Tags</h2>
                <button
                  onClick={() => setEditingTags(!editingTags)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {editingTags ? "Done" : "Edit"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full text-sm flex items-center gap-2"
                  >
                    {tag}
                    {editingTags && (
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {tags.length === 0 && !editingTags && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">No tags</p>
                )}
              </div>
              {editingTags && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                    placeholder="Add tag..."
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Notes</h2>
              <div className="mb-4">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note about this customer..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || savingNote}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingNote ? "Adding..." : "Add Note"}
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600"
                  >
                    <p className="text-sm text-gray-900 dark:text-white">{note.note}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatDate(note.created_at)}
                    </p>
                  </div>
                ))}
                {notes.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
                    No notes yet
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Activity Timeline */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Activity Timeline
              </h2>
              <div className="space-y-3 max-h-[800px] overflow-y-auto">
                {activities.map((activity) => (
                  <div
                    key={`${activity.type}-${activity.id}`}
                    className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => router.push(getActivityLink(activity))}
                  >
                    <span className="text-2xl">{getActivityIcon(activity.type)}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-white capitalize">
                            {activity.type.replace("_", " ")}
                          </span>
                          {activity.number && (
                            <span className="ml-2 text-gray-600 dark:text-gray-400">
                              {activity.number}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-gray-900 dark:text-white">
                            {formatMoney(activity.amount, currencyCode)}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(activity.date)}
                          </div>
                        </div>
                      </div>
                      {activity.status && (
                        <span
                          className={`inline-block mt-2 px-2 py-1 text-xs rounded ${
                            activity.status === "paid" || activity.status === "completed"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                              : activity.status === "draft"
                              ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                          }`}
                        >
                          {activity.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
                    No activity yet
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
