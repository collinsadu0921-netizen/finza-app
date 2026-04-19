"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { setActiveStoreId } from "@/lib/storeSession"
import { retailPaths } from "@/lib/retail/routes"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

type StoreRow = {
  id: string
  name: string
  location: string | null
  phone: string | null
  email: string | null
  business_id: string
}

export default function RetailStoreDetailPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = typeof params?.storeId === "string" ? params.storeId : ""
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [store, setStore] = useState<StoreRow | null>(null)
  const [registerCount, setRegisterCount] = useState(0)
  const [staffCount, setStaffCount] = useState(0)

  const load = useCallback(async () => {
    if (!storeId) {
      setError("Missing store")
      setLoading(false)
      return
    }
    try {
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/login")
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      const role = await getUserRole(supabase, user.id, business.id)
      if (!role) {
        setError("Access denied")
        setLoading(false)
        return
      }

      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id, name, location, phone, email, business_id")
        .eq("id", storeId)
        .eq("business_id", business.id)
        .maybeSingle()

      if (storeErr || !storeRow) {
        setError("Store not found or you do not have access.")
        setLoading(false)
        return
      }

      if (role === "manager" || role === "cashier") {
        const { data: urow } = await supabase.from("users").select("store_id").eq("id", user.id).maybeSingle()
        if (!urow?.store_id || urow.store_id !== storeId) {
          setError("You can only open stores you are assigned to.")
          setLoading(false)
          return
        }
      }

      setStore(storeRow as StoreRow)
      setActiveStoreId(storeRow.id, storeRow.name)

      const { count: regC } = await supabase
        .from("registers")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("business_id", business.id)

      const { count: stC } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)

      setRegisterCount(regC ?? 0)
      setStaffCount(stC ?? 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load store")
    } finally {
      setLoading(false)
    }
  }, [router, storeId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className={RS.containerWide}>
        <div className={RS.loadingCenter}>
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
            aria-hidden
          />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Loading store…</p>
        </div>
      </div>
    )
  }

  if (error || !store) {
    return (
      <div className={`${RS.containerWide} max-w-lg`}>
        <div className={RS.alertError}>{error || "Store unavailable"}</div>
        <button type="button" className={`${RS.backLink} mt-4`} onClick={() => router.push(retailPaths.adminStores)}>
          ← Back to stores
        </button>
      </div>
    )
  }

  const hubTiles = [
    {
      href: retailPaths.pos,
      title: "Open POS",
      subtitle: "Ring sales at the till for this store.",
      primary: true,
    },
    {
      href: retailPaths.dashboard,
      title: "Retail dashboard",
      subtitle: "Sales, inventory, and shortcuts.",
      primary: true,
    },
    {
      href: retailPaths.adminRegisters,
      title: "Manage registers",
      subtitle: "Tills and default register for this store.",
      primary: false,
    },
    {
      href: retailPaths.adminStaff,
      title: "Staff",
      subtitle: "Who works at this store.",
      primary: false,
    },
    {
      href: retailPaths.receiptSettings,
      title: "Receipt settings",
      subtitle: "Printer and receipt footer options.",
      primary: false,
    },
  ] as const

  return (
    <div className={`${RS.containerWide} max-w-3xl`}>
      <button type="button" className={`${RS.backLink} mb-4 block text-left`} onClick={() => router.push(retailPaths.adminStores)}>
        ← Back to stores
      </button>

      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Active store for POS</span>
          <span className="rounded-md border border-emerald-200 bg-white/90 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-50">
            {store.name}
          </span>
        </div>
        <p className="mt-1.5 text-emerald-900/85 dark:text-emerald-100/90">
          Till setup and checkout use this store until you open another from Stores.
        </p>
      </div>

      <h1 className={RS.pageTitle}>{store.name}</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{store.location || "—"}</p>
      {(store.phone || store.email) && (
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
          {store.phone ? (
            <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="hover:underline">
              {store.phone}
            </a>
          ) : null}
          {store.phone && store.email ? <span className="mx-1.5 text-gray-400">·</span> : null}
          {store.email ? (
            <a href={`mailto:${store.email}`} className="hover:underline">
              {store.email}
            </a>
          ) : null}
        </p>
      )}
      <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
        Registers: <span className="font-semibold">{registerCount}</span>
        <span className="mx-1.5 text-gray-400">·</span>
        Staff at this store: <span className="font-semibold">{staffCount}</span>
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Quick links</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {hubTiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={`group flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/80 ${
              tile.primary
                ? "border-gray-300 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-900"
                : "border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40"
            }`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 dark:text-white">{tile.title}</div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{tile.subtitle}</p>
            </div>
            <span
              className="shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500"
              aria-hidden
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
