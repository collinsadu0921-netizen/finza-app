"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveFirmId, setActiveFirmId, getActiveFirmName } from "@/lib/firmSession"

type Firm = {
  firm_id: string
  firm_name: string
  role: "partner" | "senior" | "junior" | "readonly"
}

/**
 * Firm Selector Component
 * Allows accounting firm users to switch between multiple firms
 * Automatically clears client context on firm change
 */
export default function FirmSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const [firms, setFirms] = useState<Firm[]>([])
  const [activeFirmId, setActiveFirmIdState] = useState<string | null>(null)
  const [activeFirmName, setActiveFirmNameState] = useState<string | null>(null)
  const [activeFirmRole, setActiveFirmRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFirms()
    loadActiveFirm()
    
    // Listen for firm changes
    const handleFirmChange = (e: CustomEvent) => {
      setActiveFirmIdState(e.detail.firmId)
      setActiveFirmNameState(e.detail.firmName)
    }
    
    window.addEventListener('firmChanged', handleFirmChange as EventListener)
    
    return () => {
      window.removeEventListener('firmChanged', handleFirmChange as EventListener)
    }
  }, [])

  const loadFirms = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      // Fetch firms from API
      const response = await fetch('/api/accounting/firm/firms')
      if (!response.ok) {
        setLoading(false)
        return
      }

      const data = await response.json()
      const firmList = (data.firms || []).map((f: any) => ({
        firm_id: f.firm_id,
        firm_name: f.firm_name,
        role: f.role,
      }))
      setFirms(firmList)
      
      // Auto-select first firm if only one and none selected
      if (firmList.length === 1) {
        const singleFirm = firmList[0]
        const currentFirmId = getActiveFirmId()
        if (!currentFirmId) {
          setActiveFirmId(singleFirm.firm_id, singleFirm.firm_name)
          setActiveFirmIdState(singleFirm.firm_id)
          setActiveFirmNameState(singleFirm.firm_name)
          setActiveFirmRole(singleFirm.role)
        }
      }
    } catch (err) {
      console.error("Error loading firms:", err)
    } finally {
      setLoading(false)
    }
  }

  const loadActiveFirm = () => {
    const firmId = getActiveFirmId()
    const firmName = getActiveFirmName()
    setActiveFirmIdState(firmId)
    setActiveFirmNameState(firmName)
    
    // Find role for active firm
    if (firmId) {
      const firm = firms.find((f) => f.firm_id === firmId)
      if (firm) {
        setActiveFirmRole(firm.role)
      }
    }
  }

  const handleFirmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedFirmId = e.target.value
    
    if (!selectedFirmId) {
      setActiveFirmId(null, null)
      setActiveFirmIdState(null)
      setActiveFirmNameState(null)
      setActiveFirmRole(null)
      return
    }

    const selectedFirm = firms.find((f) => f.firm_id === selectedFirmId)
    if (selectedFirm) {
      setActiveFirmId(selectedFirm.firm_id, selectedFirm.firm_name)
      setActiveFirmIdState(selectedFirm.firm_id)
      setActiveFirmNameState(selectedFirm.firm_name)
      setActiveFirmRole(selectedFirm.role)
      
      // Reset cached state on firm switch
      // Force page reload to clear any cached data
      if (pathname?.startsWith('/accounting')) {
        router.refresh()
      }
    }
  }

  if (loading) {
    return null
  }

  // Don't show selector if no firms
  if (firms.length === 0) {
    return null
  }

  // Only show in accounting workspace
  if (!pathname?.startsWith('/accounting')) {
    return null
  }

  // Don't show if only one firm (auto-selected)
  if (firms.length === 1) {
    return null
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="firm-selector" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
        Firm:
      </label>
      <select
        id="firm-selector"
        value={activeFirmId || ""}
        onChange={handleFirmChange}
        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">Select Firm</option>
        {firms.map((firm) => (
          <option key={firm.firm_id} value={firm.firm_id}>
            {firm.firm_name}
          </option>
        ))}
      </select>
    </div>
  )
}
