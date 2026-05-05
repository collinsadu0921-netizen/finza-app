"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatMoney } from "@/lib/money"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Customer = { id: string; name: string; email?: string | null; phone?: string | null; tags?: string[]; internal_notes?: string | null }
type Activity = { type: "invoice" | "estimate" | "order" | "payment" | "credit_note"; id: string; number: string | null; date: string; amount: number; status: string | null; entity: any }
type Note = { id: string; note: string; created_at: string; created_by: string | null }
type Summary = { totalInvoiced: number; totalPaid: number; totalCredits: number; totalOutstanding: number; overdueAmount: number; invoiceCount: number; estimateCount: number; orderCount: number; paymentCount: number; creditNoteCount: number }

export default function ServiceCustomer360Page() {
  const params = useParams()
  const router = useRouter()
  const customerId = params.id as string
  const { currencyCode } = useBusinessCurrency()

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

  const normalizedNewTag = newTag.trim()
  const canAddTag =
    normalizedNewTag.length > 0 &&
    !tags.some((tag) => tag.toLowerCase() === normalizedNewTag.toLowerCase())

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
    if (!canAddTag) return
    const updatedTags = [...tags, normalizedNewTag]
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
        return `/service/invoices/${activity.id}/view`
      case "estimate":
        return `/service/estimates/${activity.id}/view`
      case "order":
        return `/service/orders/${activity.id}/view`
      case "payment":
        return `/service/payments`
      case "credit_note":
        return `/service/credit-notes/${activity.id}/view`
      default:
        return "#"
    }
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })

  const invoices = activities.filter((activity) => activity.type === "invoice").slice(0, 5)
  const estimates = activities.filter((activity) => activity.type === "estimate").slice(0, 5)
  const orders = activities.filter((activity) => activity.type === "order").slice(0, 5)
  const payments = activities.filter((activity) => activity.type === "payment").slice(0, 5)

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading customer 360...</p>
        </div>
      
    )
  }

  if (error && !customer) {
    return (
      
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
        </div>
      
    )
  }

  return (
    
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Customer 360</p>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{customer?.name}</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  Unified profile, activity, notes, and collections overview.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {summary?.invoiceCount ?? 0} invoices
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    {summary?.paymentCount ?? 0} payments
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {tags.length} tags
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => router.push(`/service/customers/${customerId}`)} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
                  Edit Profile
                </button>
                <button onClick={() => router.push(`/service/customers/${customerId}/statement`)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  View Statement
                </button>
                <button onClick={() => router.push("/service/customers")} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                  Customers
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total Invoiced</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                {formatMoney(summary?.totalInvoiced ?? 0, currencyCode)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Collected</p>
              <p className="text-lg font-semibold text-green-600 dark:text-green-400 mt-1">
                {formatMoney(summary?.totalPaid ?? 0, currencyCode)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Outstanding</p>
              <p className="text-lg font-semibold text-orange-600 dark:text-orange-400 mt-1">
                {formatMoney(summary?.totalOutstanding ?? 0, currencyCode)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Overdue</p>
              <p className="text-lg font-semibold text-red-600 dark:text-red-400 mt-1">
                {formatMoney(summary?.overdueAmount ?? 0, currencyCode)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Credits</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                {formatMoney(summary?.totalCredits ?? 0, currencyCode)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Contact</h2>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Email</p>
                  <p className="text-gray-900 dark:text-white">{customer?.email || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Phone</p>
                  <p className="text-gray-900 dark:text-white">{customer?.phone || "Not provided"}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Billing & Tax</h2>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Outstanding Balance</p>
                  <p className="text-gray-900 dark:text-white font-medium">
                    {formatMoney(summary?.totalOutstanding ?? 0, currencyCode)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Overdue Balance</p>
                  <p className="text-gray-900 dark:text-white font-medium">
                    {formatMoney(summary?.overdueAmount ?? 0, currencyCode)}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <button onClick={() => router.push(`/service/customers/${customerId}`)} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">
                  Edit Profile
                </button>
                <button onClick={() => router.push(`/service/customers/${customerId}/statement`)} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                  Statement
                </button>
                <button onClick={() => router.push("/service/invoices/new")} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">
                  New Invoice
                </button>
                <button onClick={() => router.push("/service/estimates/new")} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">
                  New Quote
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Documents & Payments</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Latest items already available in customer activity.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { title: "Recent Invoices", items: invoices },
              { title: "Recent Quotes", items: estimates },
              { title: "Recent Proposals / Orders", items: orders },
              { title: "Recent Payments", items: payments },
            ].map((group) => (
              <div key={group.title} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{group.title}</h3>
                <div className="space-y-2">
                  {group.items.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">No records yet.</p>
                  ) : (
                    group.items.map((item) => (
                      <button
                        key={`${item.type}-${item.id}`}
                        onClick={() => router.push(getActivityLink(item))}
                        className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 p-2 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                      >
                        <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(item.date)}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {item.number || item.type.replace("_", " ")}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          {formatMoney(item.amount, currencyCode)}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Profile Notes</h2>
              <div className="space-y-2">
                <div><span className="text-sm text-gray-500 dark:text-gray-400">Email:</span><p className="text-gray-900 dark:text-white">{customer?.email || "N/A"}</p></div>
                <div><span className="text-sm text-gray-500 dark:text-gray-400">Phone:</span><p className="text-gray-900 dark:text-white">{customer?.phone || "N/A"}</p></div>
                {customer?.internal_notes && <div><span className="text-sm text-gray-500 dark:text-gray-400">Internal Notes:</span><p className="text-gray-900 dark:text-white text-sm mt-1">{customer.internal_notes}</p></div>}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Tags</h2>
                <button onClick={() => setEditingTags(!editingTags)} className="text-sm text-blue-600 hover:text-blue-700">{editingTags ? "Done" : "Edit"}</button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full text-sm flex items-center gap-2">
                    {tag}
                    {editingTags && <button onClick={() => handleRemoveTag(tag)} className="text-blue-600 hover:text-blue-800">×</button>}
                  </span>
                ))}
                {tags.length === 0 && !editingTags && <p className="text-gray-500 dark:text-gray-400 text-sm">No tags</p>}
              </div>
              {editingTags && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddTag()
                        }
                      }}
                      placeholder="Add tag..."
                      className="w-full min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    />
                    <button
                      onClick={handleAddTag}
                      disabled={!canAddTag}
                      className="px-4 py-2 sm:min-w-[110px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add Tag
                    </button>
                  </div>
                  {normalizedNewTag.length > 0 && !canAddTag && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This tag already exists.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Notes</h2>
              <div className="mb-4">
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note about this customer..." rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg" />
                <button onClick={handleAddNote} disabled={!newNote.trim() || savingNote} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {savingNote ? "Adding..." : "Add Note"}
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {notes.map((note) => (
                  <div key={note.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                    <p className="text-sm text-gray-900 dark:text-white">{note.note}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDate(note.created_at)}</p>
                  </div>
                ))}
                {notes.length === 0 && <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">No notes yet</p>}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Activity Timeline</h2>
              <div className="space-y-3 max-h-[800px] overflow-y-auto">
                {activities.map((activity) => (
                  <div key={`${activity.type}-${activity.id}`} className="flex items-start gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onClick={() => router.push(getActivityLink(activity))}>
                    <span className="text-2xl">{getActivityIcon(activity.type)}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-gray-900 dark:text-white capitalize">{activity.type.replace("_", " ")}</span>
                          {activity.number && <span className="ml-2 text-gray-600 dark:text-gray-400">{activity.number}</span>}
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-gray-900 dark:text-white">{formatMoney(activity.amount, currencyCode)}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{formatDate(activity.date)}</div>
                        </div>
                      </div>
                      {activity.status && (
                        <span className={`inline-block mt-2 px-2 py-1 text-xs rounded ${
                          activity.status === "paid" || activity.status === "completed"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                            : activity.status === "draft"
                            ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                        }`}>
                          {activity.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {activities.length === 0 && <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">No activity yet</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    
  )
}

