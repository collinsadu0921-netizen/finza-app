"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import { getUserRole } from "@/lib/userRoles"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { setActiveStoreId } from "@/lib/storeSession"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { retailPaths } from "@/lib/retail/routes"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

type Register = {
  id: string
  name: string
  store_id: string | null
  created_at: string
  is_default?: boolean
}

export default function RegistersPageImpl() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [registers, setRegisters] = useState<Register[]>([])
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [newRegisterName, setNewRegisterName] = useState("")
  /** Owner/admin: stores for choosing which branch's registers to manage */
  const [storesForPicker, setStoresForPicker] = useState<Array<{ id: string; name: string }>>([])
  /** Resolved store for list + mutations (never `"all"`) */
  const [resolvedRegisterStoreId, setResolvedRegisterStoreId] = useState<string | null>(null)
  const [resolvedStoreName, setResolvedStoreName] = useState<string | null>(null)
  const [needsStorePick, setNeedsStorePick] = useState(false)

  useEffect(() => {
    loadRegisters()
  }, [businessId])

  useEffect(() => {
    const handleStoreChange = () => {
      if (businessId) loadRegisters()
    }
    window.addEventListener("storeChanged", handleStoreChange)
    return () => window.removeEventListener("storeChanged", handleStoreChange)
  }, [businessId])

  const loadRegisters = async () => {
    try {
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

      const role = await getUserRole(supabase, user.id, business.id)
      const activeStoreId = getActiveStoreId()

      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()

      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== "all" ? activeStoreId : null,
        userData?.store_id || null
      )

      if ((role === "manager" || role === "cashier") && !effectiveStoreId) {
        setError("You must be assigned to a store to manage registers.")
        setRegisters([])
        setResolvedRegisterStoreId(null)
        setResolvedStoreName(null)
        setNeedsStorePick(false)
        setStoresForPicker([])
        setLoading(false)
        return
      }

      let listStoreId: string | null = null
      let pick = false
      if (role === "owner" || role === "admin") {
        if (activeStoreId && activeStoreId !== "all") {
          listStoreId = activeStoreId
          pick = false
        } else {
          listStoreId = null
          pick = true
        }
        const { data: storeRows } = await supabase
          .from("stores")
          .select("id, name")
          .eq("business_id", business.id)
          .order("name", { ascending: true })
        setStoresForPicker(storeRows || [])
      } else {
        setStoresForPicker([])
        listStoreId = effectiveStoreId
        pick = false
      }

      setNeedsStorePick(pick)
      setResolvedRegisterStoreId(listStoreId)

      if (listStoreId) {
        const { data: sn } = await supabase.from("stores").select("name").eq("id", listStoreId).maybeSingle()
        setResolvedStoreName(sn?.name ?? null)
      } else {
        setResolvedStoreName(null)
      }

      if (!listStoreId) {
        setRegisters([])
        setError("")
        setLoading(false)
        return
      }

      let registersQuery = supabase.from("registers").select("*").eq("business_id", business.id).eq("store_id", listStoreId)

      let regs: any[] | null = null
      let regsError: any = null

      try {
        const result = await registersQuery
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
        regs = result.data
        regsError = result.error
      } catch (err: any) {
        if (err.message?.includes("is_default") || err.code === "42703") {
          const result = await registersQuery.order("created_at", { ascending: true })
          regs = result.data
          regsError = result.error
        } else {
          regsError = err
        }
      }

      if (regsError) {
        setError(`Error loading registers: ${(regsError as { message?: string }).message ?? regsError}`)
        setLoading(false)
        return
      }

      setRegisters(regs || [])
    } catch (err: any) {
      setError(err?.message ?? "Failed to load registers")
    } finally {
      setLoading(false)
    }
  }

  const addRegister = async () => {
    setError("")
    setSuccess("")

    if (!newRegisterName.trim()) {
      setError("Please enter a register name")
      return
    }

    if (!businessId) {
      setError("Business not found. Please refresh the page.")
      return
    }

    const targetStoreId = resolvedRegisterStoreId
    if (!targetStoreId) {
      setError("Select a single store before creating a register (Stores → Open Store, or use the store picker below).")
      return
    }

    try {
      const { data: existingRegisters } = await supabase
        .from("registers")
        .select("id")
        .eq("business_id", businessId)
        .eq("store_id", targetStoreId)

      const isFirstRegister = !existingRegisters || existingRegisters.length === 0
      const insertData: any = {
        business_id: businessId,
        store_id: targetStoreId,
        name: newRegisterName.trim(),
      }

      try {
        const { error: insertError } = await supabase.from("registers").insert({
          ...insertData,
          is_default: isFirstRegister,
        })
        if (insertError) {
          if ((insertError as { message?: string }).message?.includes("is_default") || (insertError as { code?: string }).code === "42703") {
            const { error: retryError } = await supabase.from("registers").insert(insertData)
            if (retryError) throw retryError
          } else {
            throw insertError
          }
        }
      } catch (err: any) {
        if ((err as { message?: string }).message?.includes("is_default") || (err as { code?: string }).code === "42703") {
          const { error: retryError } = await supabase.from("registers").insert(insertData)
          if (retryError) throw retryError
        } else {
          throw err
        }
      }

      setNewRegisterName("")
      setSuccess("Register created successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      setError(err?.message ?? "Failed to add register")
    }
  }

  const startEdit = (register: Register) => {
    setEditingId(register.id)
    setEditName(register.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName("")
    setError("")
  }

  const saveEdit = async () => {
    setError("")
    setSuccess("")
    if (!editingId || !editName.trim()) {
      setError("Please enter a register name")
      return
    }
    if (!resolvedRegisterStoreId) {
      setError("Select a store before editing registers.")
      cancelEdit()
      return
    }
    const register = registers.find((r) => r.id === editingId)
    if (register && register.store_id !== resolvedRegisterStoreId) {
      setError("Access denied: This register belongs to a different store.")
      cancelEdit()
      return
    }
    try {
      const { error: updateError } = await supabase
        .from("registers")
        .update({ name: editName.trim() })
        .eq("id", editingId)
      if (updateError) {
        setError((updateError as { message?: string }).message ?? "Failed to update register")
        return
      }
      setSuccess("Register updated successfully!")
      setTimeout(() => setSuccess(""), 3000)
      cancelEdit()
      loadRegisters()
    } catch (err: any) {
      setError((err as { message?: string })?.message ?? "Failed to update register")
    }
  }

  const setRegisterAsDefault = async (id: string) => {
    setError("")
    setSuccess("")
    if (!resolvedRegisterStoreId) {
      setError("Select a store first.")
      return
    }
    const register = registers.find((r) => r.id === id)
    if (register && register.store_id !== resolvedRegisterStoreId) {
      setError("Access denied: This register belongs to a different store.")
      return
    }
    try {
      const { error: updateError } = await supabase.from("registers").update({ is_default: true }).eq("id", id)
      if (updateError) {
        if ((updateError as { message?: string }).message?.includes("is_default") || (updateError as { code?: string }).code === "42703") {
          setError("The is_default column is not available. Please run migration 127 or 128 first.")
          return
        }
        setError((updateError as { message?: string }).message ?? "Failed to set register as default")
        return
      }
      setSuccess("Register set as default successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      if ((err as { message?: string })?.message?.includes("is_default") || (err as { code?: string })?.code === "42703") {
        setError("The is_default column is not available. Please run migration 127 or 128 first.")
      } else {
        setError((err as { message?: string })?.message ?? "Failed to set register as default")
      }
    }
  }

  const deleteRegister = async (id: string) => {
    openConfirm({
      title: "Delete register",
      description: "Are you sure you want to delete this register? This action cannot be undone.",
      onConfirm: () => runDeleteRegister(id),
    })
  }

  const runDeleteRegister = async (id: string) => {
    if (!resolvedRegisterStoreId) {
      setError("Select a store first.")
      return
    }
    const register = registers.find((r) => r.id === id)
    if (register && register.store_id !== resolvedRegisterStoreId) {
      setError("Access denied: This register belongs to a different store.")
      return
    }
    try {
      const { count: openCount } = await supabase
        .from("cashier_sessions")
        .select("id", { count: "exact", head: true })
        .eq("register_id", id)
        .eq("status", "open")
      if (openCount && openCount > 0) {
        setError("Cannot delete: close open cashier sessions for this register first.")
        return
      }
      const { count: saleCount } = await supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("register_id", id)
      if (saleCount && saleCount > 0) {
        setError("Cannot delete: this register has sales history. Keep it or rename it instead.")
        return
      }
      const { error: deleteError } = await supabase.from("registers").delete().eq("id", id)
      if (deleteError) {
        setError((deleteError as { message?: string }).message ?? "Failed to delete register")
        return
      }
      setSuccess("Register deleted successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      setError((err as { message?: string })?.message ?? "Failed to delete register")
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
          <h1 className={RS.title}>Registers</h1>
          <p className={RS.subtitle}>Tills for this branch. Add a register for each checkout or device.</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
            {success}
          </div>
        )}

        {needsStorePick && storesForPicker.length > 0 && (
          <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span className="font-semibold">Select a store</span> to view and manage its registers (active session is &quot;All stores&quot; or unset).{" "}
            <button type="button" className="font-medium text-blue-700 underline" onClick={() => router.push(retailPaths.adminStores)}>
              Open Stores
            </button>
            <div className="mt-2 max-w-md">
              <NativeSelect
                value=""
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  const st = storesForPicker.find((s) => s.id === v)
                  setActiveStoreId(v, st?.name ?? null)
                  void loadRegisters()
                }}
              >
                <option value="">Choose store…</option>
                {storesForPicker.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        )}

        {resolvedRegisterStoreId && resolvedStoreName && (
          <p className="mb-2 text-sm text-gray-700">
            Registers for: <span className="font-semibold">{resolvedStoreName}</span>
          </p>
        )}

        <div className={`${RS.mutedPanel} mb-6`}>
          <h2 className={`${RS.sectionTitle} mb-3`}>Add register</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-[42px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              placeholder="e.g. Till 1, Front counter"
              value={newRegisterName}
              onChange={(e) => setNewRegisterName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRegister()}
              disabled={!resolvedRegisterStoreId}
            />
            <button
              type="button"
              onClick={addRegister}
              disabled={!resolvedRegisterStoreId}
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              Add register
            </button>
          </div>
        </div>

        <h2 className={`${RS.sectionTitle} mb-3`}>Registers for this store</h2>

        {registers.length === 0 ? (
          <div className={`${RS.card} ${RS.cardPad} text-center text-sm text-gray-500 dark:text-gray-400`}>
            <p className="mb-1">No registers for this store yet.</p>
            <p>Add one above, or pick a store if the list is empty.</p>
            {!resolvedRegisterStoreId && (
              <p className="mt-3 text-red-600 dark:text-red-400">
                Choose a store in{" "}
                <button type="button" onClick={() => router.push(retailPaths.adminStores)} className={RS.linkInline}>
                  Stores
                </button>{" "}
                or use the picker above.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className={RS.listStack}>
              {registers.map((register) => (
                <div key={`m-${register.id}`} className={RS.listCard}>
                  {editingId === register.id ? (
                    <div className="space-y-3">
                      <input
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={saveEdit} className={RS.primaryButton}>
                          Save
                        </button>
                        <button type="button" onClick={cancelEdit} className={RS.secondaryButton}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{register.name}</p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Added {new Date(register.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        {register.is_default ? (
                          <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                            Default till
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {!register.is_default && (
                          <button
                            type="button"
                            onClick={() => setRegisterAsDefault(register.id)}
                            className={RS.secondaryButton}
                            title="Use as default till for this store"
                          >
                            Set as default
                          </button>
                        )}
                        <button type="button" onClick={() => startEdit(register)} className={RS.secondaryButton}>
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRegister(register.id)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className={RS.tableWrap}>
              <table className="w-full min-w-[560px]">
                <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Till / register
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Default
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Created
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {registers.map((register) => (
                    <tr key={register.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      {editingId === register.id ? (
                        <>
                          <td className="px-4 py-3">
                            <input
                              className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {register.is_default ? (
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                                Default till
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {new Date(register.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={saveEdit} className={RS.primaryButton}>
                                Save
                              </button>
                              <button type="button" onClick={cancelEdit} className={RS.secondaryButton}>
                                Cancel
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{register.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {register.is_default ? (
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                                Default till
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {new Date(register.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              {!register.is_default && (
                                <button
                                  type="button"
                                  onClick={() => setRegisterAsDefault(register.id)}
                                  className={RS.secondaryButton}
                                  title="Default till for this store"
                                >
                                  Set default
                                </button>
                              )}
                              <button type="button" onClick={() => startEdit(register)} className={RS.secondaryButton}>
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteRegister(register.id)}
                                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
