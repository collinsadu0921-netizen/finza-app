"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

type Client = {
  business_id: string
  business_name: string
  access_level: "read" | "write" | "approve"
}

/**
 * Client Selector — URL only (Wave 5). Selection navigates with ?business_id= in URL.
 */
export default function ClientSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeClientId = searchParams.get("business_id")?.trim() ?? null
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const response = await fetch("/api/accounting/firm/clients")
      if (!response.ok) {
        setLoading(false)
        return
      }

      const data = await response.json()
      const clientList = (data.clients || []).map((c: any) => ({
        business_id: c.business_id,
        business_name: c.business_name,
        access_level: c.access_level,
      }))
      setClients(clientList)
    } catch (err) {
      console.error("Error loading clients:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedClientId = e.target.value
    if (!selectedClientId) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete("business_id")
      const q = params.toString()
      router.push(pathname + (q ? `?${q}` : ""))
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set("business_id", selectedClientId)
    router.push(`${pathname}?${params.toString()}`)
  }

  if (loading) {
    return null
  }

  // Don't show selector if no clients
  if (clients.length === 0) {
    return null
  }

  // Only show in accounting workspace
  if (!pathname?.startsWith('/accounting')) {
    return null
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="client-selector" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
        Working on:
      </label>
      <select
        id="client-selector"
        value={activeClientId || ""}
        onChange={handleClientChange}
        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">Select Client</option>
        {clients.map((client) => (
          <option key={client.business_id} value={client.business_id}>
            {client.business_name}
          </option>
        ))}
      </select>
    </div>
  )
}
