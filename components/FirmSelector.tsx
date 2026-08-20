"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { getActiveFirmId, setActiveFirmId, getActiveFirmName } from "@/lib/accounting/firm/session"
import { resolveActiveFirmFromMemberships } from "@/lib/accounting/firm/resolveActiveFirm"
import {
  FIRMS_TTL_MS,
  sharedClientBooksJson,
} from "@/lib/accounting/clientBooksRequestShare"

type Firm = {
  firm_id: string
  firm_name: string
  role: "partner" | "senior" | "junior" | "readonly"
}

/**
 * Firm Selector — multi-firm switcher.
 * Single-firm auto-hydration is handled centrally by resolveActiveFirmFromMemberships
 * (shell / useActiveFirm); this component only renders when multiple firms exist.
 */
export default function FirmSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const [firms, setFirms] = useState<Firm[]>([])
  const [activeFirmId, setActiveFirmIdState] = useState<string | null>(null)
  const [activeFirmName, setActiveFirmNameState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadFirms()

    const handleFirmChange = (e: CustomEvent) => {
      setActiveFirmIdState(e.detail?.firmId ?? null)
      setActiveFirmNameState(e.detail?.firmName ?? null)
    }

    window.addEventListener("firmChanged", handleFirmChange as EventListener)
    return () => {
      window.removeEventListener("firmChanged", handleFirmChange as EventListener)
    }
  }, [])

  const loadFirms = async () => {
    try {
      const response = await sharedClientBooksJson<{
        firms?: Array<{ firm_id: string; firm_name: string; role: Firm["role"] }>
      }>("/api/accounting/firm/firms", { ttlMs: FIRMS_TTL_MS })
      if (!response.ok) {
        setLoading(false)
        return
      }

      const data = response.json
      const firmList: Firm[] = (data.firms || []).map(
        (f: { firm_id: string; firm_name: string; role: Firm["role"] }) => ({
          firm_id: f.firm_id,
          firm_name: f.firm_name,
          role: f.role,
        })
      )
      setFirms(firmList)

      const resolution = resolveActiveFirmFromMemberships({
        firms: firmList,
        storedFirmId: getActiveFirmId(),
      })
      if (resolution.shouldPersist) {
        setActiveFirmId(resolution.firmId, resolution.firmName)
      }
      setActiveFirmIdState(resolution.firmId)
      setActiveFirmNameState(resolution.firmName ?? getActiveFirmName())
    } catch (err) {
      console.error("Error loading firms:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleFirmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedFirmId = e.target.value

    if (!selectedFirmId) {
      setActiveFirmId(null, null)
      setActiveFirmIdState(null)
      setActiveFirmNameState(null)
      return
    }

    const selectedFirm = firms.find((f) => f.firm_id === selectedFirmId)
    if (selectedFirm) {
      setActiveFirmId(selectedFirm.firm_id, selectedFirm.firm_name)
      setActiveFirmIdState(selectedFirm.firm_id)
      setActiveFirmNameState(selectedFirm.firm_name)

      if (pathname?.startsWith("/accounting")) {
        router.refresh()
      }
    }
  }

  if (loading) {
    return null
  }

  if (firms.length === 0) {
    return null
  }

  if (!pathname?.startsWith("/accounting")) {
    return null
  }

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
