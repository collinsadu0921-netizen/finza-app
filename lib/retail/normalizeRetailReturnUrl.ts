import { retailPaths } from "@/lib/retail/routes"

/**
 * Map legacy return targets to `/retail/**` so store-picker and other retail flows
 * do not send users to dashboard/POS/products URLs outside the retail namespace.
 */
export function normalizeRetailReturnUrl(
  raw: string | null,
  fallback: string = retailPaths.dashboard,
): string {
  if (!raw || !raw.startsWith("/")) return fallback

  const qIndex = raw.indexOf("?")
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex)
  const query = qIndex === -1 ? "" : raw.slice(qIndex)

  if (path.startsWith("/retail/")) {
    return raw
  }

  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return `${retailPaths.dashboard}${path === "/dashboard" ? "" : path.slice("/dashboard".length)}${query}`
  }
  if (path === "/pos" || path.startsWith("/pos/")) {
    return `${retailPaths.pos}${path === "/pos" ? "" : path.slice("/pos".length)}${query}`
  }
  if (path === "/select-store" || path.startsWith("/select-store/")) {
    return `${retailPaths.selectStore}${path === "/select-store" ? "" : path.slice("/select-store".length)}${query}`
  }
  if (path === "/sales" || path.startsWith("/sales/")) {
    return `${retailPaths.sales}${path === "/sales" ? "" : path.slice("/sales".length)}${query}`
  }

  if (path === "/sales-history") {
    return `${retailPaths.salesHistory}${query}`
  }
  const shReceipt = path.match(/^\/sales-history\/([^/]+)\/receipt$/)
  if (shReceipt) {
    return `${retailPaths.salesHistoryReceipt(shReceipt[1])}${query}`
  }
  const shDetail = path.match(/^\/sales-history\/([^/]+)$/)
  if (shDetail) {
    return `${retailPaths.salesHistoryDetail(shDetail[1])}${query}`
  }
  if (path.startsWith("/sales-history/")) {
    return `${retailPaths.salesHistory}${path.slice("/sales-history".length)}${query}`
  }

  if (path === "/products/new") {
    return `${retailPaths.productNew}${query}`
  }
  const prodEdit = path.match(/^\/products\/([^/]+)\/edit$/)
  if (prodEdit) {
    return `${retailPaths.productEdit(prodEdit[1])}${query}`
  }
  if (path === "/products") {
    return `${retailPaths.products}${query}`
  }
  if (path.startsWith("/products/")) {
    return `${retailPaths.products}${path.slice("/products".length)}${query}`
  }

  if (path === "/categories/new") {
    return `${retailPaths.categoryNew}${query}`
  }
  const catEdit = path.match(/^\/categories\/([^/]+)\/edit$/)
  if (catEdit) {
    return `${retailPaths.categoryEdit(catEdit[1])}${query}`
  }
  if (path === "/categories") {
    return `${retailPaths.categories}${query}`
  }
  if (path.startsWith("/categories/")) {
    return `${retailPaths.categories}${path.slice("/categories".length)}${query}`
  }

  if (path === "/inventory/history") {
    return `${retailPaths.inventoryHistory}${query}`
  }
  const invStock = path.match(/^\/inventory\/stock-history\/([^/]+)$/)
  if (invStock) {
    return `${retailPaths.inventoryStockHistory(invStock[1])}${query}`
  }
  const invAdd = path.match(/^\/inventory\/([^/]+)\/add-stock$/)
  if (invAdd) {
    return `${retailPaths.inventoryAddStock(invAdd[1])}${query}`
  }
  if (path === "/inventory") {
    return `${retailPaths.inventory}${query}`
  }
  if (path.startsWith("/inventory/")) {
    return `${retailPaths.inventory}${path.slice("/inventory".length)}${query}`
  }

  if (path === "/reports/vat/diagnostic") {
    return `${retailPaths.reportsVatDiagnostic}${query}`
  }
  if (path === "/reports/vat") {
    return `${retailPaths.reportsVat}${query}`
  }
  if (path === "/reports/profit-loss" || path === "/reports/profit-and-loss") {
    return `${retailPaths.reportsProfitAndLoss}${query}`
  }
  if (path === "/reports/balance-sheet") {
    return `${retailPaths.reportsBalanceSheet}${query}`
  }
  if (path === "/reports" || path.startsWith("/reports/")) {
    return `${retailPaths.dashboard}${query}`
  }

  if (path === "/settings/business-profile") {
    return `${retailPaths.settingsBusinessProfile}${query}`
  }

  return raw
}
