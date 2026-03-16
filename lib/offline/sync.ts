/**
 * Offline transaction sync utilities (Phase 4)
 * 
 * Handles syncing pending offline transactions to the server
 * when connectivity is restored.
 */

import {
  getPendingTransactions,
  removeOfflineTransaction,
} from "./indexedDb"

type SyncResult = {
  local_id: string
  status: "synced" | "failed"
  sale_id?: string
  error?: string
}

type SyncResponse = {
  success: boolean
  results: SyncResult[]
  synced_count: number
  failed_count: number
}

/**
 * Sync all pending offline transactions to the server
 * Returns results for each transaction
 */
export async function syncOfflineTransactions(): Promise<SyncResponse> {
  const transactions = await getPendingTransactions()

  if (transactions.length === 0) {
    return {
      success: true,
      results: [],
      synced_count: 0,
      failed_count: 0,
    }
  }

  try {
    const response = await fetch("/api/offline/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactions: transactions.map((tx) => ({
          local_id: tx.local_id,
          business_id: tx.business_id,
          store_id: tx.store_id,
          register_id: tx.register_id,
          cashier_id: tx.cashier_id,
          type: tx.type,
          payload: tx.payload,
          entry_date: tx.entry_date,
        })),
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || "Failed to sync offline transactions")
    }

    const result: SyncResponse = await response.json()

    // Remove successfully synced transactions from local queue
    for (const syncResult of result.results) {
      if (syncResult.status === "synced") {
        await removeOfflineTransaction(syncResult.local_id)
      }
    }

    return result
  } catch (error: any) {
    console.error("Error syncing offline transactions:", error)
    throw error
  }
}

/**
 * Check if device is online
 */
export function isOnline(): boolean {
  if (typeof window === "undefined") {
    return true // Server-side: assume online
  }
  return navigator.onLine
}

/**
 * Monitor online/offline status and trigger sync when online
 */
export function setupOfflineSyncListener(
  onSyncComplete?: (result: SyncResponse) => void,
  onSyncError?: (error: Error) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {} // Server-side: no-op
  }

  const handleOnline = async () => {
    try {
      const result = await syncOfflineTransactions()
      if (onSyncComplete) {
        onSyncComplete(result)
      }
    } catch (error: any) {
      console.error("Auto-sync failed:", error)
      if (onSyncError) {
        onSyncError(error)
      }
    }
  }

  window.addEventListener("online", handleOnline)

  // Return cleanup function
  return () => {
    window.removeEventListener("online", handleOnline)
  }
}
