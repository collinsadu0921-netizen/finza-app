/**
 * Retail workspace routes — use from `app/retail/**` and `components/retail/**` only.
 * Avoid `/service/**`, legacy `/dashboard`, `/products/**`, `/sales/**`, etc. in retail UI.
 */
export const retailPaths = {
  dashboard: "/retail/dashboard",
  pos: "/retail/pos",
  posPin: "/retail/pos/pin",
  selectStore: "/retail/select-store",
  products: "/retail/products",
  productNew: "/retail/products/new",
  productEdit: (id: string) => `/retail/products/${encodeURIComponent(id)}/edit`,
  categories: "/retail/categories",
  categoryNew: "/retail/categories/new",
  categoryEdit: (id: string) => `/retail/categories/${encodeURIComponent(id)}/edit`,
  inventory: "/retail/inventory",
  inventoryHistory: "/retail/inventory/history",
  inventoryStockHistory: (productId: string) =>
    `/retail/inventory/stock-history/${encodeURIComponent(productId)}`,
  inventoryAddStock: (id: string) => `/retail/inventory/${encodeURIComponent(id)}/add-stock`,
  sales: "/retail/sales",
  salesOpenSession: "/retail/sales/open-session",
  salesCloseSession: "/retail/sales/close-session",
  saleReceipt: (saleId: string) => `/retail/sales/${encodeURIComponent(saleId)}/receipt`,
  salesHistory: "/retail/sales-history",
  /** Pre-fill sales history search (e.g. scanned receipt / sale UUID). */
  salesHistoryLookup: (saleIdOrQuery: string) =>
    `/retail/sales-history?lookup=${encodeURIComponent(saleIdOrQuery)}`,
  /** Open sales history and start refund flow for this sale id (UUID). */
  salesHistoryRefund: (saleId: string) =>
    `/retail/sales-history?refund=${encodeURIComponent(saleId)}`,
  salesHistoryDetail: (id: string) => `/retail/sales-history/${encodeURIComponent(id)}`,
  salesHistoryReceipt: (id: string) => `/retail/sales-history/${encodeURIComponent(id)}/receipt`,
  receiptSettings: "/retail/admin/receipt-settings",
  adminRegisters: "/retail/admin/registers",
  adminStores: "/retail/admin/stores",
  adminStaff: "/retail/admin/staff",
  /** Store hub (summary + links) — use after activating a store from Stores. */
  adminStoreDetail: (storeId: string) => `/retail/admin/store/${encodeURIComponent(storeId)}`,
  settingsBusinessProfile: "/retail/settings/business-profile",
  reportsVat: "/retail/reports/vat",
  reportsVatDiagnostic: "/retail/reports/vat/diagnostic",
  reportsProfitAndLoss: "/retail/reports/profit-and-loss",
  reportsBalanceSheet: "/retail/reports/balance-sheet",
  /** Operational register session report (cashier_sessions), not ledger register report */
  reportsRegisterSessions: "/retail/reports/registers",
  /** Server-side open register session (retail; enforces one open session per register in DB) */
  apiRegisterOpenSession: "/api/retail/register/open-session",
  adminAnalytics: "/retail/admin/analytics",
  /** Store operating expenses (not inventory purchasing) */
  expenses: "/retail/expenses",
  expenseNew: "/retail/expenses/new",
  expenseDetail: (id: string) => `/retail/expenses/${encodeURIComponent(id)}`,
  adminSuppliers: "/retail/admin/suppliers",
  adminSupplier: (id: string) => `/retail/admin/suppliers/${encodeURIComponent(id)}`,
  adminSupplierNew: "/retail/admin/suppliers/new",
  adminPurchaseOrders: "/retail/admin/purchase-orders",
  adminPurchaseOrderNew: "/retail/admin/purchase-orders/new",
  adminPurchaseOrder: (id: string) => `/retail/admin/purchase-orders/${encodeURIComponent(id)}`,
  /** Low-stock product rows for buy-list / new supplier order page */
  apiPurchaseOrdersLowStock: "/api/retail/purchase-orders/low-stock",
} as const

/** Retail-native expense APIs (session store; no accounting URL context). */
export const retailExpenseApi = {
  list: "/api/retail/expenses",
  create: "/api/retail/expenses",
  categories: "/api/retail/expenses/categories",
  detail: (id: string) => `/api/retail/expenses/${encodeURIComponent(id)}`,
} as const

/** Retail-only report API entrypoints (session business; no `business_id` query contract). */
export const retailReportApi = {
  profitAndLoss: "/api/retail/reports/profit-and-loss",
  balanceSheet: "/api/retail/reports/balance-sheet",
} as const
