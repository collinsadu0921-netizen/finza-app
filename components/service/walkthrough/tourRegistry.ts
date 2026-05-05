/**
 * ## Service route inventory (`app/service/**`)
 *
 * ### Phase 1 — critical first-user path (tours wired in Phase 1 patch)
 * - `/service/dashboard`
 * - `/service/invoices`, `/service/invoices/new` (use `/service/invoices/new` — not `/service/invoices/create`, which redirects)
 * - `/service/customers`, `/service/services`
 * - `/service/settings/business-profile`
 *
 * ### Phase 2 — document & money workflow (expand registry later)
 * - `/service/estimates`, `/service/estimates/new`, `/service/estimates/[id]`, `/service/estimates/[id]/view`, `/service/estimates/[id]/edit`, `/service/estimates/[id]/convert`
 * - `/service/invoices/[id]`, `/service/invoices/[id]/view`, `/service/invoices/[id]/edit`, `/service/invoices/recurring`
 * - `/service/credit-notes`, `/service/credit-notes/create`, `/service/credit-notes/[id]/view`
 * - `/service/proforma`, `/service/proforma/create`, `/service/proforma/[id]/*`
 * - `/service/proposals`, `/service/proposals/new`, `/service/proposals/[id]/*`
 * - `/service/incoming-documents`, `/service/incoming-documents/[id]/review`
 * - `/service/bills`, `/service/expenses`, `/service/expenses/create`, `/service/expenses/activity`, `/service/expenses/categories`, `/service/expenses/[id]/*`
 * - `/service/recurring`, `/service/materials`, `/service/materials/new`, `/service/materials/[id]/*`
 * - `/service/jobs`, `/service/jobs/new`, `/service/jobs/[id]`
 * - `/service/reports/*`, `/service/ledger`, `/service/payments`
 * - `/service/customers/new`, `/service/customers/[id]`, `/service/customers/[id]/360`, `/service/customers/[id]/statement`
 * - `/service/services/new`, `/service/services/[id]/edit`
 *
 * ### Phase 3 — settings & advanced (expand later)
 * - `/service/settings`, `/service/settings/subscription`, `/service/settings/invoice-settings`, `/service/settings/payments`
 * - `/service/settings/team`, `/service/settings/staff`, `/service/settings/inbound-email`, `/service/settings/integrations/*`, `/service/invitations`
 * - `/service/accounting/*`, `/service/payroll/*`, `/service/assets`, `/service/inventory`, `/service/health`
 *
 * ### Redirect / alias routes — do not attach page tours here
 * - `/service/quotes` → `/service/estimates`
 * - `/service/products` → `/service/services`
 * - `/service/invoices/create` → client redirect to `/service/invoices/new`
 * - `/service/page.tsx` (segment root) — verify behavior vs `/service/dashboard`
 */

export type TourStep = {
  id: string
  /** `[data-tour="…"]` selector */
  targetSelector: string
  title: string
  body: string
}

export type TourDefinition = {
  /** Stable id for DB + query replay `?tour=` */
  tourKey: string
  tourVersion: number
  /** Normalized pathname (no query); must match `normalizeServiceTourPathname` output */
  routePattern: string
  /** When false, registry keeps the tour but the host will not auto-start it */
  active: boolean
  steps: TourStep[]
}

export const TOUR_POLL_INTERVAL_MS = 120
export const TOUR_POLL_MAX_ATTEMPTS = 28
export const TOUR_START_DELAY_MS = 420

/** Strip query string and trailing slash (except root). */
export function normalizeServiceTourPathname(fullPath: string): string {
  const [rawPath] = fullPath.split("?")
  const p = rawPath || "/"
  if (p.length > 1 && p.endsWith("/")) {
    return p.slice(0, -1)
  }
  return p
}

const SERVICE_TOURS: TourDefinition[] = [
  {
    tourKey: "service.dashboard",
    tourVersion: 1,
    routePattern: "/service/dashboard",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-dashboard-overview"]',
        title: "Your workspace",
        body: "This is your Service dashboard — a snapshot of revenue, cash, and what to do next.",
      },
      {
        id: "kpis",
        targetSelector: '[data-tour="service-dashboard-kpis"]',
        title: "Key numbers",
        body: "These cards show performance for the selected period. Open a card to dive into reports when you need detail.",
      },
      {
        id: "create",
        targetSelector: '[data-tour="service-dashboard-create-invoice"]',
        title: "Create an invoice",
        body: "Start billing customers from here, or use the Invoices page for the full list.",
      },
    ],
  },
  {
    tourKey: "service.invoices.list",
    tourVersion: 1,
    routePattern: "/service/invoices",
    active: true,
    steps: [
      {
        id: "new",
        targetSelector: '[data-tour="service-invoices-new"]',
        title: "New invoice",
        body: "Create a draft or sent invoice. Your list and totals stay in sync below.",
      },
      {
        id: "filters",
        targetSelector: '[data-tour="service-invoices-filters"]',
        title: "Find invoices",
        body: "Search and filter by status, customer, or date range to narrow down what you need.",
      },
      {
        id: "table",
        targetSelector: '[data-tour="service-invoices-table"]',
        title: "Invoice list",
        body: "Click a row to open an invoice. Export to CSV or Excel when you need a spreadsheet.",
      },
    ],
  },
  {
    tourKey: "service.invoices.create",
    tourVersion: 1,
    routePattern: "/service/invoices/new",
    active: true,
    steps: [
      {
        id: "customer",
        targetSelector: '[data-tour="service-invoice-customer"]',
        title: "Who you are billing",
        body: "Pick the customer (Bill To). Add a new customer from here if they are not in your list yet.",
      },
      {
        id: "lines",
        targetSelector: '[data-tour="service-invoice-lines"]',
        title: "Line items",
        body: "Describe what you sold, quantity, and price. Line items drive the invoice total.",
      },
      {
        id: "tax",
        targetSelector: '[data-tour="service-invoice-tax"]',
        title: "Taxes & totals",
        body: "Toggle taxes when applicable and review the total before you save or send.",
      },
      {
        id: "payment",
        targetSelector: '[data-tour="service-invoice-payment"]',
        title: "Withholding & net",
        body: "When a customer deducts WHT, you can reflect that here so the net you receive is clear.",
      },
      {
        id: "save",
        targetSelector: '[data-tour="service-invoice-save"]',
        title: "Save or send",
        body: "Save a draft to finish later, or finalize and send when the invoice is ready.",
      },
    ],
  },
  {
    tourKey: "service.customers.list",
    tourVersion: 1,
    routePattern: "/service/customers",
    active: true,
    steps: [
      {
        id: "add",
        targetSelector: '[data-tour="service-customers-add"]',
        title: "Add customers",
        body: "Create customers you invoice regularly. You can always edit details later.",
      },
      {
        id: "search",
        targetSelector: '[data-tour="service-customers-search"]',
        title: "Search & filters",
        body: "Find a customer quickly by name, phone, or email.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-customers-list"]',
        title: "Customer list",
        body: "Open a customer to see history, statements, and related activity.",
      },
    ],
  },
  {
    tourKey: "service.services.catalog",
    tourVersion: 1,
    routePattern: "/service/services",
    active: true,
    steps: [
      {
        id: "add",
        targetSelector: '[data-tour="service-services-add"]',
        title: "Catalog services",
        body: "Add services you sell so invoices and estimates stay fast and consistent.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-services-list"]',
        title: "Your services",
        body: "Edit pricing, tax codes, and active status as your catalog evolves.",
      },
    ],
  },
  {
    tourKey: "service.settings.business_profile",
    tourVersion: 1,
    routePattern: "/service/settings/business-profile",
    active: true,
    steps: [
      {
        id: "logo",
        targetSelector: '[data-tour="service-profile-logo"]',
        title: "Branding",
        body: "Upload a logo used on documents and in the app where your business appears.",
      },
      {
        id: "identity",
        targetSelector: '[data-tour="service-profile-identity"]',
        title: "Business identity",
        body: "Legal and trading names, entity type, and tax settings support accurate documents.",
      },
      {
        id: "contact",
        targetSelector: '[data-tour="service-profile-contact"]',
        title: "Contact details",
        body: "Phone and email help customers reach you and appear on outbound communications.",
      },
      {
        id: "save",
        targetSelector: '[data-tour="service-profile-save"]',
        title: "Save changes",
        body: "Save when you are done — country and home currency are required for invoicing.",
      },
    ],
  },
  {
    tourKey: "service.estimates.list",
    tourVersion: 1,
    routePattern: "/service/estimates",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-estimates-overview"]',
        title: "Your quotes pipeline",
        body: "Track draft, sent, and accepted quotes in one place.",
      },
      {
        id: "new",
        targetSelector: '[data-tour="service-estimates-new"]',
        title: "Create a new quote",
        body: "Start a new quote when a customer requests pricing.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-estimates-list"]',
        title: "Review quote list",
        body: "Use filters and open any row to follow up or convert accepted quotes.",
      },
    ],
  },
  {
    tourKey: "service.payments.list",
    tourVersion: 1,
    routePattern: "/service/payments",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-payments-overview"]',
        title: "Cash received overview",
        body: "This page shows money collected from customer payments.",
      },
      {
        id: "filters",
        targetSelector: '[data-tour="service-payments-filters"]',
        title: "Filter by date range",
        body: "Narrow the period to audit collections quickly.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-payments-list"]',
        title: "Check payment records",
        body: "Open invoice links from each row to reconcile payment details.",
      },
    ],
  },
  {
    tourKey: "service.proformas.list",
    tourVersion: 1,
    routePattern: "/service/proforma",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-proformas-overview"]',
        title: "Proforma tracking",
        body: "Use proformas for pre-invoice approval and customer confirmation.",
      },
      {
        id: "new",
        targetSelector: '[data-tour="service-proformas-new"]',
        title: "Create a proforma",
        body: "Start a new proforma for a deal before issuing a final invoice.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-proformas-list"]',
        title: "Monitor status",
        body: "Watch sent, accepted, and converted proformas from this list.",
      },
    ],
  },
  {
    tourKey: "service.proposals.list",
    tourVersion: 1,
    routePattern: "/service/proposals",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-proposals-overview"]',
        title: "Client proposals",
        body: "Manage formal proposals and move won work into execution.",
      },
      {
        id: "new",
        targetSelector: '[data-tour="service-proposals-new"]',
        title: "Create proposal",
        body: "Draft a new proposal when you need structured client approval.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-proposals-list"]',
        title: "Manage proposal list",
        body: "Open rows to edit, convert, or clean up older drafts.",
      },
    ],
  },
  {
    tourKey: "service.expenses.list",
    tourVersion: 1,
    routePattern: "/service/expenses",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-expenses-overview"]',
        title: "Expense control center",
        body: "Track spending and tax portions across your business costs.",
      },
      {
        id: "new",
        targetSelector: '[data-tour="service-expenses-new"]',
        title: "Add expense",
        body: "Record a new cost as soon as you spend to keep reports accurate.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-expenses-list"]',
        title: "Review expense records",
        body: "Filter and open entries to validate amounts, tax, and receipts.",
      },
    ],
  },
  {
    tourKey: "service.credit_notes.list",
    tourVersion: 1,
    routePattern: "/service/credit-notes",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-credit-notes-overview"]',
        title: "Invoice adjustments",
        body: "Use credit notes for refunds and invoice corrections.",
      },
      {
        id: "new",
        targetSelector: '[data-tour="service-credit-notes-new"]',
        title: "Create credit note",
        body: "Issue a credit note when you need to reduce a previously billed amount.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-credit-notes-list"]',
        title: "Track credit status",
        body: "Monitor drafts, issued notes, and applied credits from this list.",
      },
    ],
  },
  {
    tourKey: "service.incoming_documents.list",
    tourVersion: 1,
    routePattern: "/service/incoming-documents",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-incoming-documents-overview"]',
        title: "Document inbox",
        body: "Centralize receipts and supplier documents here for quick processing.",
      },
      {
        id: "upload",
        targetSelector: '[data-tour="service-incoming-documents-upload"]',
        title: "Bring in documents",
        body: "Use inbound email setup to capture files into this queue.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-incoming-documents-list"]',
        title: "Review queue",
        body: "Work through items that need review, linking, or follow-up actions.",
      },
    ],
  },
  {
    tourKey: "service.settings.index",
    tourVersion: 1,
    routePattern: "/service/settings",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-settings-overview"]',
        title: "Settings hub",
        body: "Use this page to jump into profile, billing, payments, and document controls.",
      },
      {
        id: "workspace",
        targetSelector: '[data-tour="service-settings-profile-card"]',
        title: "Workspace details",
        body: "Open business profile and subscription from this section first.",
      },
      {
        id: "payments",
        targetSelector: '[data-tour="service-settings-payment-card"]',
        title: "Invoices and collections",
        body: "Manage invoice appearance and payment integrations here.",
      },
    ],
  },
  {
    tourKey: "service.settings.payment_details",
    tourVersion: 1,
    routePattern: "/service/settings/payments",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-payment-settings-overview"]',
        title: "Payment integrations",
        body: "Set provider credentials and defaults used for collections.",
      },
      {
        id: "momo",
        targetSelector: '[data-tour="service-payment-settings-momo"]',
        title: "MoMo details",
        body: "Configure MTN and manual wallet details your team can use.",
      },
      {
        id: "save",
        targetSelector: '[data-tour="service-payment-settings-save"]',
        title: "Save settings",
        body: "Save changes after updating provider credentials or defaults.",
      },
    ],
  },
  {
    tourKey: "service.settings.documents",
    tourVersion: 1,
    routePattern: "/service/settings/invoice-settings",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-document-settings-overview"]',
        title: "Document defaults",
        body: "Control what customers see on invoices, quotes, and proformas.",
      },
      {
        id: "numbering",
        targetSelector: '[data-tour="service-document-settings-numbering"]',
        title: "Numbering rules",
        body: "Set prefixes and numbering defaults for each document type.",
      },
      {
        id: "save",
        targetSelector: '[data-tour="service-document-settings-save"]',
        title: "Publish updates",
        body: "Save to apply new branding, numbering, and payment display details.",
      },
    ],
  },
  {
    tourKey: "service.settings.users",
    tourVersion: 1,
    routePattern: "/service/settings/team",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-users-overview"]',
        title: "Team access",
        body: "Manage who can access this workspace and what they can do.",
      },
      {
        id: "invite",
        targetSelector: '[data-tour="service-users-invite"]',
        title: "Add members",
        body: "Invite teammates with the right role, then fine-tune permissions.",
      },
      {
        id: "list",
        targetSelector: '[data-tour="service-users-list"]',
        title: "Review members",
        body: "Update roles, edit permissions, or remove access from this list.",
      },
    ],
  },
  {
    tourKey: "service.subscription",
    tourVersion: 1,
    routePattern: "/service/settings/subscription",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-subscription-overview"]',
        title: "Plan and billing",
        body: "See your current plan status and renewal context.",
      },
      {
        id: "cycle",
        targetSelector: '[data-tour="service-subscription-billing-cycle"]',
        title: "Billing cadence",
        body: "Choose monthly, quarterly, or annual pricing before payment.",
      },
      {
        id: "plans",
        targetSelector: '[data-tour="service-subscription-plans"]',
        title: "Compare plans",
        body: "Review features and start checkout for upgrades or renewals.",
      },
    ],
  },
  {
    tourKey: "service.settings.inbound_email",
    tourVersion: 1,
    routePattern: "/service/settings/inbound-email",
    active: true,
    steps: [
      {
        id: "overview",
        targetSelector: '[data-tour="service-inbound-email-overview"]',
        title: "Inbound document email",
        body: "Use a dedicated address to send supplier files into Finza.",
      },
      {
        id: "address",
        targetSelector: '[data-tour="service-inbound-email-settings"]',
        title: "Address controls",
        body: "Create, rotate, activate, or deactivate your inbound address here.",
      },
      {
        id: "actions",
        targetSelector: '[data-tour="service-inbound-email-actions"]',
        title: "Manage safely",
        body: "Only owners and admins can change the route configuration.",
      },
    ],
  },
]

export function listServiceTourDefinitions(): readonly TourDefinition[] {
  return SERVICE_TOURS
}

export function getActiveTourForPath(normalizedPath: string): TourDefinition | undefined {
  return SERVICE_TOURS.find((t) => t.active && t.steps.length > 0 && t.routePattern === normalizedPath)
}

export function getTourDefinitionByKey(tourKey: string): TourDefinition | undefined {
  return SERVICE_TOURS.find((t) => t.tourKey === tourKey && t.steps.length > 0)
}
