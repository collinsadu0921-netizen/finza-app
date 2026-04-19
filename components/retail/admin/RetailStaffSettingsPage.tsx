"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { retailPaths } from "@/lib/retail/routes"
import { getUserRole } from "@/lib/userRoles"
import { canActorCreateStaffRole, canActorRemoveBusinessMember } from "@/lib/staff/businessStaffPermissions"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

/** Retail POS staff (business members) */
type BusinessUser = {
  id: string
  user_id: string
  role: string
  created_at: string
  user: {
    id: string
    email: string | null
    full_name: string | null
    store_id: string | null
  } | null
  store: {
    id: string
    name: string
  } | null
}

export default function RetailStaffSettingsPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [businessUsers, setBusinessUsers] = useState<BusinessUser[]>([])
  const [businessId, setBusinessId] = useState("")
  const [workspaceMismatch, setWorkspaceMismatch] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([])
  /** Current viewer's role in this business (from business_users / owner) */
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [businessOwnerId, setBusinessOwnerId] = useState<string | null>(null)

  // Form fields for new system user (retail businesses)
  const [systemUserForm, setSystemUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "cashier" as "admin" | "manager" | "cashier",
    store_id: "",
    pin_code: "",
    auto_generate_password: false,
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      if (business.industry === "service") {
        setWorkspaceMismatch(true)
        setViewerRole(null)
        setViewerUserId(null)
        setBusinessOwnerId(null)
        setBusinessUsers([])
        setStores([])
        setLoading(false)
        return
      }
      setWorkspaceMismatch(false)

      const roleForViewer = await getUserRole(supabase, user.id, business.id)
      setViewerRole(roleForViewer)
      setViewerUserId(user.id)

      const { data: bizRow } = await supabase.from("businesses").select("owner_id").eq("id", business.id).maybeSingle()
      setBusinessOwnerId((bizRow as { owner_id?: string | null } | null)?.owner_id ?? null)

      const { data: businessUsersData, error: usersError } = await supabase
          .from("business_users")
          .select(`
            id,
            user_id,
            role,
            created_at,
            users:user_id (
              id,
              email,
              full_name,
              store_id
            )
          `)
          .eq("business_id", business.id)
          .order("created_at", { ascending: false })

        if (usersError) {
          setError(`Error loading staff: ${usersError.message}`)
          setLoading(false)
          return
        }

        // Load all stores for the business
        const { data: storesData } = await supabase
          .from("stores")
          .select("id, name")
          .eq("business_id", business.id)
          .order("name", { ascending: true })

        setStores(storesData || [])

        // Get store names for users with store assignments
        const usersWithStores = (businessUsersData || []).filter(
          (bu: any) => bu.users?.store_id
        )
        const storeIds = Array.from(
          new Set(usersWithStores.map((bu: any) => bu.users.store_id).filter(Boolean))
        )

        let storesMap = new Map()
        if (storeIds.length > 0 && storesData) {
          storesMap = new Map(storesData.map((s) => [s.id, s]))
        }

        // Map business users with store information
        const mappedUsers = (businessUsersData || []).map((bu: any) => ({
          id: bu.id,
          user_id: bu.user_id,
          role: bu.role,
          created_at: bu.created_at,
          user: bu.users,
          store: bu.users?.store_id
            ? storesMap.get(bu.users.store_id) || null
            : null,
        }))

      setBusinessUsers(mappedUsers)

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load staff")
      setLoading(false)
    }
  }

  const handleRemoveBusinessUser = async (businessUserId: string, userName: string) => {
    openConfirm({
      title: "Remove user from business",
      description: `Are you sure you want to remove ${userName} from this business?`,
      onConfirm: () => runRemoveBusinessUser(businessUserId, userName),
    })
  }

  const runRemoveBusinessUser = async (businessUserId: string, userName: string) => {
    try {
      const res = await fetch("/api/staff/remove-business-user", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_user_id: businessUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || "Failed to remove user")
        return
      }

      setSuccess("User removed successfully")
      loadData()
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to remove user")
    }
  }

  const handleCreateSystemUser = async () => {
    setError("")

    if (!viewerRole || !canActorCreateStaffRole(viewerRole, systemUserForm.role)) {
      setError("You are not allowed to create a staff member with this role.")
      return
    }

    // Validate based on role
    if (!systemUserForm.name.trim()) {
      setError("Name is required")
      return
    }

    if (systemUserForm.role === "admin" || systemUserForm.role === "manager") {
      if (!systemUserForm.email.trim()) {
        setError("Email is required for admin and manager roles")
        return
      }

      if (!systemUserForm.password && !systemUserForm.auto_generate_password) {
        setError("Password is required or enable auto-generate")
        return
      }

      if (systemUserForm.password && systemUserForm.password.length < 6) {
        setError("Password must be at least 6 characters")
        return
      }
    }

    if (systemUserForm.role === "cashier") {
      if (stores.length === 0) {
        setError("No stores available. Please create a store first before adding cashiers.")
        return
      }

      if (!systemUserForm.store_id) {
        setError("Store assignment is required for cashiers")
        return
      }

      if (!systemUserForm.pin_code) {
        setError("PIN code is required for cashiers")
        return
      }

      if (systemUserForm.pin_code.length < 4 || systemUserForm.pin_code.length > 6) {
        setError("PIN code must be 4-6 digits")
        return
      }

      if (!/^\d+$/.test(systemUserForm.pin_code)) {
        setError("PIN code must contain only digits")
        return
      }
    }

    try {
      const response = await fetch("/api/staff/create-system-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: systemUserForm.name.trim(),
          email: systemUserForm.email.trim() || null,
          password: systemUserForm.password || null,
          role: systemUserForm.role,
          store_id: systemUserForm.store_id || null,
          pin_code: systemUserForm.pin_code || null,
          auto_generate_password: systemUserForm.auto_generate_password,
        }),
      })

      let data: any = {}
      const text = await response.text()

      // Try to parse JSON, handling double-encoded responses
      try {
        if (text) {
          // First try direct parse
          data = JSON.parse(text)
          // If result is a string, it might be double-encoded, try parsing again
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data)
            } catch (e) {
              // If second parse fails, use the string as error message
              data = { error: data }
            }
          }
        }
      } catch (parseError) {
        console.error("Failed to parse response:", parseError, "Raw text:", text)
        // If parsing fails, try to extract error message from raw text
        const errorMatch = text.match(/"error"\s*:\s*"([^"]+)"/)
        if (errorMatch) {
          data = { error: errorMatch[1] }
        } else {
          setError(`Invalid response from server: ${text.substring(0, 200)}`)
          return
        }
      }

      if (!response.ok) {
        const errorMessage = data?.error || data?.message || `Failed to create user (${response.status} ${response.statusText})`
        setError(errorMessage)
        return
      }

      if (data.warning) {
        setError(data.warning)
      } else {
        setSuccess(
          data.password
            ? `${systemUserForm.name} created successfully! Password: ${data.password}`
            : `${systemUserForm.name} created successfully!`
        )
      }

      setShowAddModal(false)
      setSystemUserForm({
        name: "",
        email: "",
        password: "",
        role: "cashier",
        store_id: "",
        pin_code: "",
        auto_generate_password: false,
      })
      loadData()
      setTimeout(() => {
        setSuccess("")
        setError("")
      }, 5000)
    } catch (err: any) {
      console.error("Error creating system user:", {
        message: err.message,
        stack: err.stack,
        error: err
      })
      setError(err.message || "Failed to create user")
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
      case "admin":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "manager":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      case "cashier":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
    }
  }

  const canManageStaff =
    viewerRole === "owner" || viewerRole === "admin" || viewerRole === "manager"

  if (loading) {
    return (
      <div className={RS.outer}>
        <div className={RS.containerWide}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    )
  }

  if (workspaceMismatch) {
    return (
      <div className={RS.outer}>
        <div className={RS.container}>
          <h1 className={RS.title}>Staff</h1>
          <p className={`${RS.subtitle} mt-2`}>
            Staff are managed here for retail. Your workspace is set to Service — switch to a retail business to use this
            screen.
          </p>
          <button type="button" onClick={() => router.push(retailPaths.dashboard)} className={`${RS.primaryButton} mt-4`}>
            Retail dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.outer}>
      <div className={RS.containerWide}>
        <div className={RS.headerBlock}>
          <button
            type="button"
            onClick={() => router.push(viewerRole === "cashier" ? retailPaths.pos : retailPaths.dashboard)}
            className={RS.backLink}
          >
            {viewerRole === "cashier" ? "← Back to POS" : "← Back to Dashboard"}
          </button>
          <div className={RS.actionsRow}>
            <div>
              <h1 className={RS.title}>Staff</h1>
              <p className={RS.subtitle}>
                {viewerRole === "cashier"
                  ? "View your team. Ask an owner, admin, or manager to add or remove people."
                  : "Cashiers, managers, and admins who can sign in to POS and retail tools."}
              </p>
            </div>
            {canManageStaff && (
              <button type="button" onClick={() => setShowAddModal(true)} className={`${RS.primaryButton} shrink-0 gap-2`}>
                Add staff
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
            {success}
          </div>
        )}

        <div className={`${RS.card} overflow-hidden`}>
          <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6">
            <h2 className={RS.sectionTitle}>Team</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Name, role, and store assignment</p>
          </div>

          {businessUsers.length === 0 ? (
            <div className={`${RS.cardPad} text-center text-sm text-gray-500 dark:text-gray-400`}>
              No staff yet. Add team members with{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">Add staff</span>.
            </div>
          ) : (
            <>
              <div className={`${RS.listStack} px-4 pb-1`}>
                {businessUsers.map((bu) => (
                  <div key={`m-${bu.id}`} className="border-b border-gray-100 py-4 last:border-0 dark:border-gray-800">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{bu.user?.full_name || "—"}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{bu.user?.email || "—"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getRoleBadgeColor(bu.role)}`}>
                        {bu.role.charAt(0).toUpperCase() + bu.role.slice(1)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      Store: {bu.store?.name || (bu.user?.store_id ? "Unassigned" : "—")}
                    </p>
                    {canManageStaff &&
                      bu.role !== "owner" &&
                      viewerUserId &&
                      bu.user?.id &&
                      canActorRemoveBusinessMember(viewerRole, viewerUserId, bu.user.id, bu.role, businessOwnerId) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBusinessUser(bu.id, bu.user?.full_name || bu.user?.email || "User")}
                          className="mt-3 text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                        >
                          Remove
                        </button>
                      )}
                  </div>
                ))}
              </div>

              <div className={RS.tableWrap}>
                <table className="w-full min-w-[720px]">
                  <thead className="bg-gray-50 dark:bg-gray-800/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Role
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Store
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {businessUsers.map((bu) => (
                      <tr key={bu.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {bu.user?.full_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {bu.user?.email || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getRoleBadgeColor(bu.role)}`}>
                            {bu.role.charAt(0).toUpperCase() + bu.role.slice(1)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {bu.store?.name || (bu.user?.store_id ? "Unassigned" : "—")}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {canManageStaff &&
                            bu.role !== "owner" &&
                            viewerUserId &&
                            bu.user?.id &&
                            canActorRemoveBusinessMember(
                              viewerRole,
                              viewerUserId,
                              bu.user.id,
                              bu.role,
                              businessOwnerId
                            ) && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveBusinessUser(bu.id, bu.user?.full_name || bu.user?.email || "User")
                                }
                                className="font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                              >
                                Remove
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Add Staff Modal - retail */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 my-8">
              <div className="flex-shrink-0 border-b border-gray-200 p-6 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className={`${RS.sectionTitle} text-xl`}>Add team member</h2>
                  <button
                    onClick={() => {
                      setShowAddModal(false)
                      setSystemUserForm({
                        name: "",
                        email: "",
                        password: "",
                        role: "cashier",
                        store_id: "",
                        pin_code: "",
                        auto_generate_password: false,
                      })
                      setError("")
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {error && (
                <div className="px-6 pt-4 flex-shrink-0">
                  <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <div className="flex-1">
                        <p className="font-semibold">Error:</p>
                        <p>{error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={systemUserForm.name}
                    onChange={(e) => setSystemUserForm({ ...systemUserForm, name: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Role *
                  </label>
                  <NativeSelect
                    value={systemUserForm.role}
                    onChange={(e) => {
                      const newRole = e.target.value as "admin" | "manager" | "cashier"
                      setSystemUserForm({
                        ...systemUserForm,
                        role: newRole,
                        email: newRole === "cashier" ? "" : systemUserForm.email,
                        password: newRole === "cashier" ? "" : systemUserForm.password,
                        pin_code: newRole !== "cashier" ? "" : systemUserForm.pin_code,
                        store_id: newRole === "cashier" ? systemUserForm.store_id : "",
                      })
                    }}
                  >
                    <option value="cashier">Cashier</option>
                    {(viewerRole === "owner" || viewerRole === "admin") && <option value="manager">Manager</option>}
                    {viewerRole === "owner" && <option value="admin">Admin</option>}
                  </NativeSelect>
                </div>

                {/* Admin/Manager Fields */}
                {(systemUserForm.role === "admin" || systemUserForm.role === "manager") && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        value={systemUserForm.email}
                        onChange={(e) => setSystemUserForm({ ...systemUserForm, email: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Store (optional)
                      </label>
                      <NativeSelect
                        value={systemUserForm.store_id}
                        onChange={(e) => setSystemUserForm({ ...systemUserForm, store_id: e.target.value })}
                      >
                        <option value="">All stores</option>
                        {stores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={systemUserForm.auto_generate_password}
                          onChange={(e) =>
                            setSystemUserForm({
                              ...systemUserForm,
                              auto_generate_password: e.target.checked,
                              password: e.target.checked ? "" : systemUserForm.password,
                            })
                          }
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          Auto-generate password
                        </span>
                      </label>
                    </div>

                    {!systemUserForm.auto_generate_password && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Password *
                        </label>
                        <input
                          type="password"
                          value={systemUserForm.password}
                          onChange={(e) => setSystemUserForm({ ...systemUserForm, password: e.target.value })}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                          required
                          minLength={6}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Minimum 6 characters
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Cashier Fields */}
                {systemUserForm.role === "cashier" && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Store *
                      </label>
                      <NativeSelect
                        value={systemUserForm.store_id}
                        onChange={(e) => setSystemUserForm({ ...systemUserForm, store_id: e.target.value })}
                        required
                      >
                        <option value="">Select a store</option>
                        {stores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        PIN Code * (4-6 digits)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={systemUserForm.pin_code}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, "")
                          if (value.length <= 6) {
                            setSystemUserForm({ ...systemUserForm, pin_code: value })
                          }
                        }}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        required
                        minLength={4}
                        maxLength={6}
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Must be 4-6 digits, unique per store
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-gray-200 p-6 dark:border-gray-700 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setSystemUserForm({
                      name: "",
                      email: "",
                      password: "",
                      role: "cashier",
                      store_id: "",
                      pin_code: "",
                      auto_generate_password: false,
                    })
                    setError("")
                  }}
                  className={`${RS.secondaryButton} w-full sm:w-auto`}
                >
                  Cancel
                </button>
                <button type="button" onClick={handleCreateSystemUser} className={`${RS.primaryButton} w-full sm:w-auto sm:min-w-[10rem]`}>
                  Create staff
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50/90 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/25 dark:text-blue-100">
          <p className="font-medium">How sign-in works</p>
          <p className="mt-1 text-blue-900/90 dark:text-blue-200/90">
            Cashiers use a store PIN at the till. Managers and admins use email and password. Access follows each person&apos;s
            role.
          </p>
        </div>
      </div>
    </div>
  )
}
