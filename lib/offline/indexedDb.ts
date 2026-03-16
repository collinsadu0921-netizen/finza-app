/**
 * IndexedDB utilities for offline transaction queue (Phase 4)
 * 
 * Stores offline transactions locally on the device until connectivity is restored.
 * Transactions are synced in FIFO order (by entry_date).
 */

const DB_NAME = "finza_offline_queue"
const DB_VERSION = 1
const STORE_NAME = "offline_transactions"

type OfflineTransaction = {
  local_id: string // Device-generated unique ID
  business_id: string
  store_id: string
  register_id: string
  cashier_id: string
  type: "sale" | "refund" | "void"
  payload: any // Full transaction payload
  entry_date: string // ISO timestamp
  created_at: string // ISO timestamp (when queued locally)
}

let dbInstance: IDBDatabase | null = null

/**
 * Initialize IndexedDB database
 */
export async function initOfflineQueue(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"))
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "local_id" })
        // Index by entry_date for FIFO ordering
        store.createIndex("entry_date", "entry_date", { unique: false })
        // Index by created_at for chronological ordering
        store.createIndex("created_at", "created_at", { unique: false })
      }
    }
  })
}

/**
 * Generate a unique local ID for an offline transaction
 */
export function generateLocalId(): string {
  // Format: offline_<timestamp>_<random>
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  return `offline_${timestamp}_${random}`
}

/**
 * Add a transaction to the offline queue
 */
export async function addOfflineTransaction(
  transaction: Omit<OfflineTransaction, "local_id" | "created_at">
): Promise<string> {
  const db = await initOfflineQueue()
  const localId = generateLocalId()

  const offlineTx: OfflineTransaction = {
    ...transaction,
    local_id: localId,
    created_at: new Date().toISOString(),
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.add(offlineTx)

    request.onsuccess = () => {
      resolve(localId)
    }

    request.onerror = () => {
      reject(new Error("Failed to add transaction to offline queue"))
    }
  })
}

/**
 * Get all pending offline transactions (sorted by entry_date for FIFO)
 */
export async function getPendingTransactions(): Promise<OfflineTransaction[]> {
  const db = await initOfflineQueue()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly")
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index("entry_date")
    const request = index.getAll()

    request.onsuccess = () => {
      const transactions = request.result as OfflineTransaction[]
      // Sort by entry_date (FIFO order)
      transactions.sort(
        (a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
      )
      resolve(transactions)
    }

    request.onerror = () => {
      reject(new Error("Failed to get pending transactions"))
    }
  })
}

/**
 * Remove a transaction from the offline queue (after successful sync)
 */
export async function removeOfflineTransaction(localId: string): Promise<void> {
  const db = await initOfflineQueue()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(localId)

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(new Error("Failed to remove transaction from offline queue"))
    }
  })
}

/**
 * Get count of pending offline transactions
 */
export async function getPendingCount(): Promise<number> {
  const transactions = await getPendingTransactions()
  return transactions.length
}

/**
 * Clear all offline transactions (use with caution)
 */
export async function clearOfflineQueue(): Promise<void> {
  const db = await initOfflineQueue()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite")
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(new Error("Failed to clear offline queue"))
    }
  })
}
