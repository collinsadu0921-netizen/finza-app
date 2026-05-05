"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getTabIndustryMode } from "@/lib/industryMode"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { NativeSelect } from "@/components/ui/NativeSelect"

function isPayrollStaffIndustry(mode: string | null): boolean {
  return mode === "service" || mode === "professional"
}

// Service business staff (payroll employees)
type StaffMember = {
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
  status: string
  start_date: string
  created_at: string
}

// Retail business staff (system users)
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

export default function ServiceStaffSettingsPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const { format: formatSalary } = useBusinessCurrency()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [businessUsers, setBusinessUsers] = useState<BusinessUser[]>([])
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([])

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

  // Form fields for new staff (service businesses only)
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
    start_date: new Date().toISOString().split("T")[0],
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

      // Check industry mode
      const tabIndustry = getTabIndustryMode() || business.industry
      setBusinessIndustry(tabIndustry)

      if (isPayrollStaffIndustry(tabIndustry)) {
        const res = await fetch("/api/staff/list")
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(
            typeof payload?.error === "string"
              ? payload.error
              : `Error loading staff (${res.status})`
          )
          setLoading(false)
          return
        }

        setStaff((payload.staff as StaffMember[]) || [])
      } else {
        // For retail businesses, use business_users (system users)
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
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load staff")
      setLoading(false)
    }
  }

  const handleAddStaff = async () => {
    if (!formData.name.trim()) {
      setError("Please enter staff name")
      return
    }

    if (!businessId) {
      setError("Business ID is missing. Please refresh the page.")
      return
    }

    if (!formData.basic_salary || parseFloat(formData.basic_salary) <= 0) {
      setError("Please enter a valid basic salary")
      return
    }

    try {
      setError("")
      const res = await fetch("/api/staff/create", {
        method: "POST",
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
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("Error adding staff:", payload)
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Error adding staff (${res.status})`
        )
        return
      }

      setSuccess(`${formData.name} has been added successfully!`)
      setShowAddModal(false)
      setFormData({
        name: "",
        position: "",
        phone: "",
        whatsapp_phone: "",
        email: "",
        basic_salary: "",
        employment_type: "full_time",
        bank_name: "",
        bank_account: "",
        ssnit_number: "",
        tin_number: "",
        start_date: new Date().toISOString().split("T")[0],
      })
      loadData()
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to add staff")
    }
  }

  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    openConfirm({
      title: "Remove staff member",
      description: `Are you sure you want to remove ${staffName}?`,
      onConfirm: () => runDeleteStaff(staffId, staffName),
    })
  }

  const runDeleteStaff = async (staffId: string, staffName: string) => {
    try {
      const res = await fetch(`/api/staff/${staffId}`, { method: "DELETE" })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : `Error removing staff (${res.status})`
        )
        return
      }

      setSuccess("Staff member removed successfully")
      loadData()
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to remove staff")
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
      const { error } = await supabase
        .from("business_users")
        .delete()
        .eq("id", businessUserId)
        .eq("business_id", businessId)

      if (error) {
        setError(`Error removing user: ${error.message}`)
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

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800"
      case "inactive":
        return "bg-yellow-100 text-yellow-800"
      case "terminated":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getEmploymentTypeBadgeColor = (type: string) => {
    switch (type) {
      case "full_time":
        return "bg-blue-100 text-blue-800"
      case "part_time":
        return "bg-purple-100 text-purple-800"
      case "casual":
        return "bg-orange-100 text-orange-800"
      default:
        return "bg-gray-100 text-gray-800"
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

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  // Service / professional industry: payroll staff (tab mode — not retail POS staff)
  if (isPayrollStaffIndustry(businessIndustry)) {
    const activeStaff = staff.filter((member) => member.status === "active").length
    const inactiveStaff = staff.filter((member) => member.status === "inactive").length
    const terminatedStaff = staff.filter((member) => member.status === "terminated").length
    const monthlyPayroll = staff.reduce((sum, member) => sum + (Number(member.basic_salary) || 0), 0)

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                  Staff Management
                </h1>
                <p className="text-gray-600 dark:text-gray-400 text-lg">
                  Team roster and payroll-ready staff details
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Staff
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total Staff</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white mt-1">{staff.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Active</p>
              <p className="text-2xl font-semibold text-green-600 dark:text-green-400 mt-1">{activeStaff}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {inactiveStaff} inactive, {terminatedStaff} terminated
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Monthly Payroll Base</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white mt-1">{formatSalary(monthlyPayroll)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Employment Mix</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                Full-time {staff.filter((member) => member.employment_type === "full_time").length} · Part-time{" "}
                {staff.filter((member) => member.employment_type === "part_time").length} · Casual{" "}
                {staff.filter((member) => member.employment_type === "casual").length}
              </p>
            </div>
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

          {/* Staff List */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Team Members</h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">{staff.length} records</span>
            </div>
            {staff.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <svg className="w-7 h-7 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">No staff members yet</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Add your first team member to prepare payroll and workforce records.
                </p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-5 inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Staff
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Position</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Contact</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Salary</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {staff.map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{member.name}</div>
                          {member.email && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">{member.email}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-white">{member.position || "—"}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-white">{member.phone || "—"}</div>
                          {member.whatsapp_phone && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">WhatsApp: {member.whatsapp_phone}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {formatSalary(member.basic_salary)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getEmploymentTypeBadgeColor(member.employment_type)}`}>
                            {member.employment_type.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(member.status)}`}>
                            {member.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => router.push(`/service/payroll/staff/${member.id}`)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                          >
                            View
                          </button>
                          <button
                            onClick={() => router.push(`/service/payroll/staff/${member.id}/edit`)}
                            className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-4"
                          >
                            Edit
                          </button>
                          {member.status !== "terminated" && (
                            <button
                              onClick={() => handleDeleteStaff(member.id, member.name)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
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
            )}

            {staff.length > 0 && (
              <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
                {staff.map((member) => (
                  <div
                    key={member.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{member.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{member.position || "No position set"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(member.status)}`}>
                          {member.status}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">Salary</p>
                        <p className="font-medium text-gray-900 dark:text-white">{formatSalary(member.basic_salary)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">Employment</p>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getEmploymentTypeBadgeColor(member.employment_type)}`}>
                          {member.employment_type.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <p>{member.phone || "No phone"}</p>
                      {member.email && <p className="text-gray-500 dark:text-gray-400">{member.email}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-700 text-sm">
                      <button
                        onClick={() => router.push(`/service/payroll/staff/${member.id}`)}
                        className="text-blue-600 dark:text-blue-400 font-medium"
                      >
                        View
                      </button>
                      <button
                        onClick={() => router.push(`/service/payroll/staff/${member.id}/edit`)}
                        className="text-green-600 dark:text-green-400 font-medium"
                      >
                        Edit
                      </button>
                      {member.status !== "terminated" && (
                        <button
                          onClick={() => handleDeleteStaff(member.id, member.name)}
                          className="text-red-600 dark:text-red-400 font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Staff Modal */}
          {showAddModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Add Staff Member</h2>
                    <button
                      onClick={() => setShowAddModal(false)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Position
                      </label>
                      <input
                        type="text"
                        value={formData.position}
                        onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        WhatsApp Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.whatsapp_phone}
                        onChange={(e) => setFormData({ ...formData, whatsapp_phone: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Basic Salary (₵) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.basic_salary}
                        onChange={(e) => setFormData({ ...formData, basic_salary: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Employment Type
                      </label>
                      <NativeSelect
                        value={formData.employment_type}
                        onChange={(e) => setFormData({ ...formData, employment_type: e.target.value as any })}
                      >
                        <option value="full_time">Full Time</option>
                        <option value="part_time">Part Time</option>
                        <option value="casual">Casual</option>
                      </NativeSelect>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        value={formData.bank_name}
                        onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Bank Account
                      </label>
                      <input
                        type="text"
                        value={formData.bank_account}
                        onChange={(e) => setFormData({ ...formData, bank_account: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        SSNIT Number
                      </label>
                      <input
                        type="text"
                        value={formData.ssnit_number}
                        onChange={(e) => setFormData({ ...formData, ssnit_number: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        TIN Number
                      </label>
                      <input
                        type="text"
                        value={formData.tin_number}
                        onChange={(e) => setFormData({ ...formData, tin_number: e.target.value })}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-4">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddStaff}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all"
                  >
                    Add Staff
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Retail Business: Show system users (business_users)
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Staff Management
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Manage system users who can access your retail operations (cashiers, managers, admins)
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Staff
            </button>
          </div>
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

        {/* Business Users List */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">System Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Store Assignment</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {businessUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No system users found. Users are added through the business setup process.
                    </td>
                  </tr>
                ) : (
                  businessUsers.map((bu) => (
                    <tr key={bu.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {bu.user?.full_name || "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {bu.user?.email || "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getRoleBadgeColor(bu.role)}`}>
                          {bu.role.charAt(0).toUpperCase() + bu.role.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {bu.store?.name || (bu.user?.store_id ? "Unassigned Store" : "No Store")}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {bu.role !== "owner" && (
                          <button
                            onClick={() => handleRemoveBusinessUser(bu.id, bu.user?.full_name || bu.user?.email || "User")}
                            className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add Staff Modal - retail */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col my-8">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Add System User</h2>
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
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
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
                        Store Assignment
                      </label>
                      <NativeSelect
                        value={systemUserForm.store_id}
                        onChange={(e) => setSystemUserForm({ ...systemUserForm, store_id: e.target.value })}
                      >
                        <option value="">No Store (Global Access)</option>
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
                        Store Assignment *
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
              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-4">
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
                  className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSystemUser}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all"
                >
                  Create User
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-400 px-4 py-3 rounded">
          <p className="font-semibold mb-1">Note</p>
          <p className="text-sm">
            System users can access the POS, manage registers, and perform operations based on their role.
            Cashiers use PIN codes for quick access, while admins and managers use email/password authentication.
          </p>
        </div>
      </div>
    </div>
  )
}
