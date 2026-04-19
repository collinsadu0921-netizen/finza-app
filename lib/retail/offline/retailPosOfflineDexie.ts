"use client"

import Dexie, { type Table } from "dexie"

type CatalogSnapshotRow = {
  /** `${businessId}::${storeId}` */
  id: string
  payload: string
  updatedAt: string
}

/**
 * Dexie database for Retail POS offline catalog (Phase 1).
 * Separate from `lib/offline/indexedDb.ts` (raw IDB offline transaction queue).
 */
export class RetailPosOfflineDexie extends Dexie {
  catalogSnapshots!: Table<CatalogSnapshotRow, string>

  constructor() {
    super("FinzaRetailPosOffline")
    this.version(1).stores({
      catalogSnapshots: "id, updatedAt",
    })
  }
}

let _db: RetailPosOfflineDexie | null = null

export function getRetailPosOfflineDb(): RetailPosOfflineDexie {
  if (!_db) {
    _db = new RetailPosOfflineDexie()
  }
  return _db
}
