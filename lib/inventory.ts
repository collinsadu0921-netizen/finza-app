/**
 * Inventory utility functions for stock management
 */

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock" | "not_tracked"

export interface StockStatusInfo {
  status: StockStatus
  label: string
  color: string
  badgeColor: string
}

/**
 * Get stock status for a product
 * @param stockQuantity Current stock quantity
 * @param lowStockThreshold Low stock threshold (defaults to 5 if not provided)
 * @param trackStock Whether stock tracking is enabled (defaults to true)
 * @returns Stock status information
 */
export function getStockStatus(
  stockQuantity: number | null | undefined,
  lowStockThreshold: number | null | undefined = null,
  trackStock: boolean | null | undefined = true
): StockStatusInfo {
  // If stock tracking is disabled, return not_tracked
  if (trackStock === false) {
    return {
      status: "not_tracked",
      label: "Not Tracked",
      color: "bg-gray-100 text-gray-800",
      badgeColor: "bg-gray-500",
    }
  }

  // Default threshold is 5 if not set
  const threshold = lowStockThreshold !== null && lowStockThreshold !== undefined ? lowStockThreshold : 5
  const stock = Math.floor(stockQuantity !== null && stockQuantity !== undefined ? Number(stockQuantity) : 0)

  if (stock === 0) {
    return {
      status: "out_of_stock",
      label: "OUT",
      color: "bg-red-100 text-red-800",
      badgeColor: "bg-red-500",
    }
  }

  if (threshold > 0 && stock <= threshold) {
    return {
      status: "low_stock",
      label: "LOW",
      color: "bg-yellow-100 text-yellow-800",
      badgeColor: "bg-yellow-500",
    }
  }

  return {
    status: "in_stock",
    label: "In Stock",
    color: "bg-green-100 text-green-800",
    badgeColor: "bg-green-500",
  }
}

/**
 * Check if a product is low stock or out of stock
 * @param stockQuantity Current stock quantity
 * @param lowStockThreshold Low stock threshold (defaults to 5 if not provided)
 * @param trackStock Whether stock tracking is enabled (defaults to true)
 * @returns true if product is low stock or out of stock
 */
export function isLowStock(
  stockQuantity: number | null | undefined,
  lowStockThreshold: number | null | undefined = null,
  trackStock: boolean | null | undefined = true
): boolean {
  const status = getStockStatus(stockQuantity, lowStockThreshold, trackStock)
  return status.status === "low_stock" || status.status === "out_of_stock"
}
