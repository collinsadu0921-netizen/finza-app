"use client"

import { useEffect, useState } from "react"
import { getActiveFirmId } from "@/lib/firmSession"

/**
 * Firm Role Badge Component
 * Displays the user's role in the active firm (Partner / Senior / Junior / Readonly)
 * Always visible in accounting workspace
 */
export default function FirmRoleBadge() {
  const [firmRole, setFirmRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFirmRole()
    
    // Listen for firm changes
    const handleFirmChange = () => {
      loadFirmRole()
    }
    
    window.addEventListener('firmChanged', handleFirmChange as EventListener)
    
    return () => {
      window.removeEventListener('firmChanged', handleFirmChange as EventListener)
    }
  }, [])

  const loadFirmRole = async () => {
    try {
      const firmId = getActiveFirmId()
      if (!firmId) {
        setFirmRole(null)
        setLoading(false)
        return
      }

      const response = await fetch("/api/accounting/firm/firms")
      if (response.ok) {
        const data = await response.json()
        const firm = data.firms?.find((f: any) => f.firm_id === firmId)
        if (firm) {
          setFirmRole(firm.role)
        }
      }
    } catch (err) {
      console.error("Error loading firm role:", err)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !firmRole) {
    return null
  }

  const roleLabels: Record<string, string> = {
    partner: "Partner",
    senior: "Senior",
    junior: "Junior",
    readonly: "Readonly",
  }

  const roleColors: Record<string, string> = {
    partner: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    senior: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    junior: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    readonly: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  }

  return (
    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${roleColors[firmRole] || roleColors.readonly}`}>
      {roleLabels[firmRole] || firmRole}
    </span>
  )
}
