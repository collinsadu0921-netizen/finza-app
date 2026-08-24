"use client"

import { useEffect } from "react"
import { useWorkspaceBusiness } from "@/components/WorkspaceBusinessContext"
import { SERVICE_LIST_REMOUNT_TTL_MS, sharedJsonGet } from "@/lib/client/sharedJsonGet"
import {
  buildMaterialsWorkspaceUrl,
  materialsWorkspaceCacheKey,
} from "@/lib/service/materialsWorkspaceCache"

/**
 * Start the default materials workspace GET as soon as workspace identity is known,
 * without waiting for TierGate to mount the page.
 */
export default function MaterialsWorkspacePrefetch() {
  const { business } = useWorkspaceBusiness()
  const businessId = business?.id ?? ""

  useEffect(() => {
    const url = buildMaterialsWorkspaceUrl({ page: 1, limit: 25 })
    const cacheKey = materialsWorkspaceCacheKey(url, businessId)
    if (!cacheKey) return
    void sharedJsonGet(url, { ttlMs: SERVICE_LIST_REMOUNT_TTL_MS, cacheKey })
  }, [businessId])

  return null
}
