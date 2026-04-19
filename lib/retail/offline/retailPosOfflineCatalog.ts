"use client"

import type { RetailPosOfflineCatalogPayloadV1 } from "@/lib/retail/offline/types"
import { isRetailPosOfflineCatalogPayloadV1 } from "@/lib/retail/offline/types"
import { getRetailPosOfflineDb } from "@/lib/retail/offline/retailPosOfflineDexie"

export function retailPosOfflineCatalogKey(businessId: string, storeId: string): string {
  return `${businessId}::${storeId}`
}

export async function saveRetailPosOfflineCatalog(payload: RetailPosOfflineCatalogPayloadV1): Promise<void> {
  const db = getRetailPosOfflineDb()
  const id = retailPosOfflineCatalogKey(payload.businessId, payload.storeId)
  await db.catalogSnapshots.put({
    id,
    payload: JSON.stringify(payload),
    updatedAt: payload.lastSyncedAt,
  })
}

export async function loadRetailPosOfflineCatalog(
  businessId: string,
  storeId: string
): Promise<RetailPosOfflineCatalogPayloadV1 | null> {
  const db = getRetailPosOfflineDb()
  const row = await db.catalogSnapshots.get(retailPosOfflineCatalogKey(businessId, storeId))
  if (!row?.payload) return null
  try {
    const parsed: unknown = JSON.parse(row.payload)
    if (!isRetailPosOfflineCatalogPayloadV1(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export async function hasRetailPosOfflineCatalog(businessId: string, storeId: string): Promise<boolean> {
  const row = await loadRetailPosOfflineCatalog(businessId, storeId)
  return row !== null
}
