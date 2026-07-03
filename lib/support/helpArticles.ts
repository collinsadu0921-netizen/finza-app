export type HelpArticle = {
  id: string
  title: string
  category: string
  tags: string[]
  summary: string
  steps: string[]
  /** Optional note when a feature needs a specific plan tier. */
  planNote?: string
  relatedLinks?: {
    label: string
    href: string
  }[]
}

/** Display order for Help Center browse. Empty categories are hidden. */
export const HELP_CATEGORIES = [
  "Getting started",
  "Quotes & sales documents",
  "Invoices",
  "Payments & receipts",
  "Credit notes",
  "Customers",
  "Expenses & bills",
  "Documents & automation",
  "Projects & operations",
  "Reports",
  "Tax & Ghana compliance",
  "Accounting & ledger",
  "Payroll",
  "Team & permissions",
  "Settings & integrations",
  "Troubleshooting",
] as const

export type HelpCategory = (typeof HELP_CATEGORIES)[number]

export const HELP_CATEGORY_META: Record<
  HelpCategory,
  { description: string }
> = {
  "Getting started": {
    description: "Your dashboard, daily workflow, and following up on money owed to you.",
  },
  "Quotes & sales documents": {
    description: "Quotes, proposals, and proformas — before you send a final invoice.",
  },
  Invoices: {
    description: "Create, send, and track invoices and recurring billing.",
  },
  "Payments & receipts": {
    description: "Record customer payments and share receipts as proof.",
  },
  "Credit notes": {
    description: "Reduce what a customer owes when you need to adjust an invoice.",
  },
  Customers: {
    description: "Save client details, statements, and payment history.",
  },
  "Expenses & bills": {
    description: "Money going out — your spending and what you owe suppliers.",
  },
  "Documents & automation": {
    description: "Forward receipts and supplier invoices into Finza automatically.",
  },
  "Projects & operations": {
    description: "Services you sell, materials, and job tracking.",
  },
  Reports: {
    description: "Understand how your business is doing — in plain language.",
  },
  "Tax & Ghana compliance": {
    description: "VAT, withholding tax, and Ghana tax reports in Finza.",
  },
  "Accounting & ledger": {
    description: "Behind-the-scenes books — explained for owners, not accountants.",
  },
  Payroll: {
    description: "Pay staff, run payroll, and manage salary advances.",
  },
  "Team & permissions": {
    description: "Who can access what in your Finza workspace.",
  },
  "Settings & integrations": {
    description: "Business profile, invoice appearance, MoMo, and WhatsApp.",
  },
  Troubleshooting: {
    description: "When something looks wrong or you need Finza support.",
  },
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    id: "use-dashboard",
    title: "How to use the dashboard",
    category: "Getting started",
    tags: ["dashboard", "overview", "summary", "home"],
    summary: "Your dashboard is the first place to check cash, unpaid invoices, and how the month is going.",
    steps: [
      "Open Dashboard from the sidebar when you sign in.",
      "The top cards show Available cash, Customer balances (money owed to you), Unpaid invoices, and Bills or liabilities (money you owe).",
      "Use the period dropdown to view an earlier month — Finza compares revenue and expenses for that period.",
      "The collections section highlights overdue invoices so you know who to follow up with.",
      "Quick actions let you jump to create an invoice, record an expense, or open reports.",
      "Click Help in the top-right if you need guides while you work.",
    ],
    relatedLinks: [{ label: "Dashboard", href: "/service/dashboard" }],
  },
  {
    id: "dashboard-metrics-explained",
    title: "What your dashboard numbers mean",
    category: "Getting started",
    tags: ["dashboard", "cash", "receivable", "payable", "unpaid", "metrics"],
    summary: "Plain-language guide to the main figures on your Service dashboard — no accounting degree needed.",
    steps: [
      "Available cash — money in your business bank or cash accounts as Finza records it. It is not the same as MoMo balance unless you record transfers.",
      "Customer balances (accounts receivable) — total customers still owe you across all unpaid or partly paid invoices.",
      "Unpaid invoices — operational total of what is still outstanding on sent invoices (after payments and credit notes).",
      "Bills / current liabilities — money your business owes suppliers and similar short-term obligations.",
      "Revenue and expenses on the chart — income from invoices and costs from expenses for the selected period.",
      "If a number looks wrong, check that all payments, credit notes, and expenses are recorded for the right dates.",
    ],
    relatedLinks: [{ label: "Dashboard", href: "/service/dashboard" }],
  },
  {
    id: "follow-up-overdue-invoices",
    title: "How to follow up on overdue invoices",
    category: "Getting started",
    tags: ["overdue", "collections", "follow up", "unpaid", "reminder"],
    summary: "Spot invoices past their due date and chase payment without losing track.",
    steps: [
      "Open Invoices and filter by Overdue, or check the collections section on your dashboard.",
      "An invoice is overdue when its due date has passed and money is still outstanding.",
      "Open the invoice to see the customer contact details and amount still owed.",
      "Resend the invoice link by email or WhatsApp if the customer needs another copy.",
      "When payment arrives, record it on the invoice so the balance clears and overdue status updates.",
      "For repeated late payers, use the customer statement to see their full history.",
    ],
    relatedLinks: [
      { label: "Invoices", href: "/service/invoices" },
      { label: "Dashboard", href: "/service/dashboard" },
    ],
  },

  // ── Quotes & sales documents ─────────────────────────────────────────────
  {
    id: "quote-proforma-invoice-explained",
    title: "Quote vs proforma vs invoice — what is the difference?",
    category: "Quotes & sales documents",
    tags: ["quote", "proforma", "invoice", "estimate", "proposal", "sales"],
    summary: "Know which document to use at each stage of a sale.",
    steps: [
      "Quote — a price offer to a customer before work starts. Good for 'this is what we will charge if you agree.'",
      "Proforma invoice — looks like an invoice but is for approval or customs; convert it to a real invoice when the customer confirms.",
      "Invoice — the official bill. Use this when you want to record revenue and collect payment.",
      "Proposal — a richer sales document (scope, terms) that can become a quote when accepted.",
      "Typical flow: Proposal → Quote → Proforma (optional) → Invoice → Payment → Receipt.",
      "Only sent invoices affect your unpaid totals and most tax reports — quotes and proformas are preparatory.",
    ],
    relatedLinks: [
      { label: "Quotes", href: "/service/quotes" },
      { label: "Proforma invoices", href: "/service/proforma" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "create-send-quote",
    title: "How to create and send a quote",
    category: "Quotes & sales documents",
    tags: ["quote", "estimate", "create", "send"],
    summary: "Build a quote with line items and share it with your customer.",
    steps: [
      "Open Quotes from the sidebar (Operations → Quotes).",
      "Click New Quote and choose a customer.",
      "Add line items — pick from your services catalog or type descriptions and prices.",
      "Set validity dates if you want the quote to expire.",
      "Save and send by email or WhatsApp, or download a PDF to share manually.",
      "When the customer accepts, convert the quote to an invoice (see related guide).",
    ],
    relatedLinks: [
      { label: "Quotes", href: "/service/quotes" },
      { label: "Create a quote", href: "/service/estimates/new" },
    ],
  },
  {
    id: "convert-quote-to-invoice",
    title: "How to convert a quote to an invoice",
    category: "Quotes & sales documents",
    tags: ["quote", "convert", "invoice", "estimate"],
    summary: "Turn an accepted quote into a billable invoice in a few clicks.",
    steps: [
      "Open the quote from your Quotes list.",
      "Click Convert to Invoice (or similar action on the quote view).",
      "Finza copies customer and line items into a new draft invoice.",
      "Review dates, tax, and totals before sending.",
      "Send the invoice when you are ready to collect payment.",
    ],
    relatedLinks: [
      { label: "Quotes", href: "/service/quotes" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "create-proforma-invoice",
    title: "How to create a proforma invoice",
    category: "Quotes & sales documents",
    tags: ["proforma", "pro forma", "create", "approval"],
    summary: "Issue a proforma for customer approval before you bill for real.",
    steps: [
      "Open Proforma Invoices from the sidebar (Billing → Proforma Invoices).",
      "Click New Proforma and select a customer.",
      "Add line items and check whether taxes (VAT/NHIL/GETFund) should apply.",
      "Save and send to the customer for approval.",
      "When they confirm, accept or convert the proforma to a regular invoice.",
    ],
    relatedLinks: [{ label: "Proforma invoices", href: "/service/proforma" }],
  },

  // ── Invoices ─────────────────────────────────────────────────────────────
  {
    id: "create-invoice",
    title: "How to create an invoice",
    category: "Invoices",
    tags: ["invoice", "billing", "new", "create", "draft"],
    summary: "Create a draft invoice, add your customer and line items, then send when ready.",
    steps: [
      "Open Invoices from the sidebar (Billing → Invoices).",
      "Click New Invoice or Create Invoice.",
      "Choose a customer (or add one first under Customers).",
      "Add line items — description, quantity, and price. Pick saved services to fill in faster.",
      "If your business uses Ghana taxes, Finza adds VAT, NHIL, and GETFund lines where configured.",
      "Set the issue date and due date.",
      "Save as draft to review, or send when you are ready to share it with your customer.",
    ],
    relatedLinks: [
      { label: "Go to Invoices", href: "/service/invoices" },
      { label: "Add a customer", href: "/service/customers/new" },
    ],
  },
  {
    id: "send-invoice",
    title: "How to send an invoice",
    category: "Invoices",
    tags: ["invoice", "send", "email", "whatsapp", "pdf"],
    summary: "Send a draft or already-issued invoice by email, WhatsApp, or PDF.",
    steps: [
      "Open the invoice from your Invoices list.",
      "If the invoice is still a draft, click Send and choose Email or WhatsApp.",
      "Check the customer contact details are correct before sending.",
      "Use Issue & Download if you need a PDF to share manually.",
      "For a sent invoice, use Send again if you need to resend the link.",
      "Your customer receives a link to view the invoice online.",
    ],
    relatedLinks: [{ label: "Invoices list", href: "/service/invoices" }],
  },
  {
    id: "setup-recurring-invoices",
    title: "How to set up recurring invoices",
    category: "Invoices",
    tags: ["recurring", "subscription", "monthly", "automatic", "schedule"],
    summary: "Bill the same customer on a schedule — weekly, monthly, or custom.",
    steps: [
      "Open Recurring invoices from the sidebar (Billing → Recurring invoices).",
      "Click New recurring invoice and choose the customer and line items.",
      "Set the frequency (e.g. monthly) and start date.",
      "Choose whether Finza should auto-send each generated invoice or save as draft for review.",
      "Save the schedule — Finza shows the next run date.",
      "Pause or edit the schedule if the arrangement changes.",
    ],
    relatedLinks: [{ label: "Recurring invoices", href: "/service/recurring" }],
  },
  {
    id: "invoice-paid-partial",
    title: "Why is an invoice paid or partially paid?",
    category: "Invoices",
    tags: ["paid", "partial", "status", "balance", "overdue"],
    summary: "Finza updates invoice status from payments and credit notes — not by hand.",
    steps: [
      "Paid — recorded payments plus applied credits cover the invoice total.",
      "Partially paid — some payment or credit was applied, but money is still outstanding.",
      "Sent — no payment recorded yet; not necessarily overdue until the due date passes.",
      "Overdue — due date has passed and money is still owed (may show as sent or partially paid with an overdue flag).",
      "Check the Payments section on the invoice to see what was recorded.",
      "If the balance looks wrong, confirm all payments and applied credit notes are entered correctly.",
    ],
    relatedLinks: [{ label: "Invoices", href: "/service/invoices" }],
  },
  {
    id: "unpaid-invoices",
    title: "How to understand unpaid invoices",
    category: "Invoices",
    tags: ["unpaid", "outstanding", "overdue", "collections"],
    summary: "See which invoices still have money owed and which are past due.",
    steps: [
      "Open Invoices and use filters: Sent, Partially Paid, or Overdue.",
      "Outstanding balance = invoice total minus payments minus applied credit notes.",
      "The dashboard Unpaid invoices card shows the total still owed across your business.",
      "An invoice past its due date with money still owed may appear in overdue filters and collections.",
      "Follow up with customers, then record payments when money arrives.",
    ],
    relatedLinks: [
      { label: "Invoices", href: "/service/invoices" },
      { label: "Dashboard", href: "/service/dashboard" },
    ],
  },
  {
    id: "customer-invoice-approval",
    title: "What is customer invoice approval?",
    category: "Invoices",
    tags: ["approval", "customer", "sign off", "accepted", "rejected"],
    summary: "Track whether your customer has approved an invoice before or after you send it.",
    steps: [
      "On an invoice view page, find the Customer approval section.",
      "Mark approval as Requested when you need the customer to confirm the invoice.",
      "Update to Approved when they agree, or Rejected if they dispute it.",
      "Approval is for your workflow and records — it does not replace sending the invoice or recording payment.",
      "Use the approval filter on the invoice list to see which invoices need follow-up.",
    ],
    relatedLinks: [{ label: "Invoices", href: "/service/invoices" }],
  },

  // ── Payments & receipts ──────────────────────────────────────────────────
  {
    id: "record-payment",
    title: "How to record a customer payment",
    category: "Payments & receipts",
    tags: ["payment", "paid", "cash", "momo", "bank", "transfer"],
    summary: "Record money your customer paid against an invoice.",
    steps: [
      "Open the invoice you received payment for.",
      "Click Record Payment or Add Payment.",
      "Enter the amount, date, and payment method (cash, mobile money, bank transfer, etc.).",
      "Add a reference or note if helpful (e.g. MoMo transaction ID).",
      "If the customer withheld tax (WHT), enter the withheld amount if your form shows that field.",
      "Save — Finza updates how much is still outstanding on the invoice.",
    ],
    relatedLinks: [
      { label: "Payments list", href: "/service/payments" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "record-partial-payment",
    title: "How to record a partial payment",
    category: "Payments & receipts",
    tags: ["partial", "part payment", "installment", "balance"],
    summary: "When a customer pays less than the full invoice, record what they paid and track the rest.",
    steps: [
      "Open the invoice and click Record Payment.",
      "Enter only the amount they paid now — not the full invoice total.",
      "Save the payment — the invoice status becomes Partially paid.",
      "The remaining balance stays on the invoice until you record further payments or apply a credit note.",
      "Send a receipt for the partial amount if the customer wants proof.",
      "Record additional payments later until the balance reaches zero.",
    ],
    relatedLinks: [
      { label: "Invoices", href: "/service/invoices" },
      { label: "Payments", href: "/service/payments" },
    ],
  },
  {
    id: "send-receipt",
    title: "How to send or view a receipt",
    category: "Payments & receipts",
    tags: ["receipt", "payment", "proof", "whatsapp"],
    summary: "After you record a payment, share a receipt with your customer.",
    steps: [
      "Open the invoice that has been paid (fully or partly).",
      "In the payments section, find the payment you want to share.",
      "Use Send receipt or copy the receipt link for WhatsApp or email.",
      "Your customer can open the link to view or download proof of payment.",
      "You can also open Payments from the sidebar to review recent receipts.",
    ],
    relatedLinks: [{ label: "Payments", href: "/service/payments" }],
  },

  // ── Credit notes ─────────────────────────────────────────────────────────
  {
    id: "when-to-use-credit-note",
    title: "When should I use a credit note?",
    category: "Credit notes",
    tags: ["credit note", "refund", "discount", "mistake", "adjustment"],
    summary: "Use a credit note when you need to reduce what a customer owes — not for every change.",
    steps: [
      "Use a credit note when you overcharged, gave a post-invoice discount, or need to reverse part of a bill.",
      "Do not use a credit note instead of editing a draft — fix drafts before you send.",
      "After an invoice is sent, a credit note is the correct way to reduce the balance.",
      "Credit notes do not replace recording a refund payment — if you returned cash, record that too if needed.",
      "You can issue more than one credit note on an invoice up to the outstanding amount.",
    ],
    relatedLinks: [{ label: "Credit notes", href: "/service/credit-notes" }],
  },
  {
    id: "create-credit-note",
    title: "How to create a credit note",
    category: "Credit notes",
    tags: ["credit note", "create", "issue", "invoice"],
    summary: "Issue a credit note linked to an invoice you already sent.",
    steps: [
      "Open Credit Notes from the sidebar, or click Issue Credit Note on an invoice.",
      "Select the invoice you are adjusting (must be sent, paid, or overdue — not draft).",
      "Add credit lines — amount, description, and quantity as needed.",
      "Save the credit note.",
      "Apply it to the invoice when you are ready (see 'How to apply a credit note').",
    ],
    relatedLinks: [
      { label: "Credit notes", href: "/service/credit-notes" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "apply-credit-note",
    title: "How to apply a credit note to an invoice",
    category: "Credit notes",
    tags: ["apply", "credit note", "balance", "reduce"],
    summary: "Applying a credit note reduces what the customer still owes on the invoice.",
    steps: [
      "Open the credit note from Credit Notes or from the linked invoice.",
      "Click Apply to invoice (or Apply credit note).",
      "Confirm the amount to apply — it cannot exceed the invoice outstanding balance.",
      "After applying, the invoice balance drops and the credit note shows as applied.",
      "If the credit is larger than what was owed, Finza may show a refundable balance — contact support if unsure how to handle it.",
    ],
    relatedLinks: [
      { label: "Credit notes", href: "/service/credit-notes" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },

  // ── Customers ────────────────────────────────────────────────────────────
  {
    id: "add-customer",
    title: "How to add a customer",
    category: "Customers",
    tags: ["customer", "client", "contact"],
    summary: "Save customer details once and reuse them on invoices and quotes.",
    steps: [
      "Open Customers from the sidebar.",
      "Click Add Customer or New Customer.",
      "Enter name, phone, email, and address as needed.",
      "Save — the customer appears when you create invoices, quotes, or proformas.",
    ],
    relatedLinks: [{ label: "Customers", href: "/service/customers" }],
  },
  {
    id: "customer-statement",
    title: "How to view a customer statement",
    category: "Customers",
    tags: ["statement", "balance", "history", "customer"],
    summary: "See everything one customer owes, paid, and was invoiced — in one place.",
    steps: [
      "Open Customers and click the customer name.",
      "Open Statement or Customer statement from their profile.",
      "Review total invoiced, paid, outstanding, and overdue amounts.",
      "Use this when chasing payment or answering 'how much do I owe?'",
      "Record new payments from the invoice page to keep the statement accurate.",
    ],
    relatedLinks: [{ label: "Customers", href: "/service/customers" }],
  },

  // ── Expenses & bills ─────────────────────────────────────────────────────
  {
    id: "add-expense",
    title: "How to add an expense",
    category: "Expenses & bills",
    tags: ["expense", "cost", "spending", "receipt"],
    summary: "Record business spending for your records and reports.",
    steps: [
      "Open Expenses from the sidebar (Billing → Expenses).",
      "Click Record Expense or New Expense.",
      "Enter date, amount, category, and description.",
      "Attach a receipt photo or file if you have one.",
      "Save — the expense appears in your expense list and Profit & Loss report.",
    ],
    relatedLinks: [{ label: "Expenses", href: "/service/expenses" }],
  },
  {
    id: "expense-categories",
    title: "Expense categories explained",
    category: "Expenses & bills",
    tags: ["category", "expense", "organize", "report"],
    summary: "Categories group your spending so reports show where money went.",
    steps: [
      "When recording an expense, choose a category (e.g. Rent, Transport, Supplies).",
      "Consistent categories make your Profit & Loss report easier to read.",
      "Open Expense categories under Expenses settings to review or add categories if your plan allows.",
      "Do not confuse expenses with owner withdrawals — money you take for personal use may need a different entry (see Accounting guides).",
    ],
    relatedLinks: [{ label: "Expenses", href: "/service/expenses" }],
  },
  {
    id: "add-supplier-bill",
    title: "How to add a supplier bill",
    category: "Expenses & bills",
    tags: ["bill", "supplier", "payable", "vendor"],
    summary: "Track money you owe suppliers before you pay them.",
    planNote: "Supplier bills are available on Professional plans and above.",
    steps: [
      "Open Supplier Bills from the sidebar.",
      "Click New Bill and enter supplier name, bill number, and line items.",
      "Set issue and due dates.",
      "Save — the bill appears in your payables until you record payment.",
      "You can also create a bill from an incoming document after review.",
    ],
    relatedLinks: [{ label: "Supplier bills", href: "/service/bills" }],
  },
  {
    id: "pay-supplier-bill",
    title: "How to pay a supplier bill",
    category: "Expenses & bills",
    tags: ["bill", "pay", "supplier", "payment"],
    summary: "Record when you pay a supplier so your books show the bill as settled.",
    planNote: "Supplier bills are available on Professional plans and above.",
    steps: [
      "Open Supplier Bills and select the bill you paid.",
      "Click Record Payment or Add Payment.",
      "Enter amount, date, and payment method (bank, MoMo, cash).",
      "Save — the remaining balance on the bill updates.",
      "Fully paid bills no longer count toward what you owe suppliers.",
    ],
    relatedLinks: [{ label: "Supplier bills", href: "/service/bills" }],
  },

  // ── Documents & automation ───────────────────────────────────────────────
  {
    id: "incoming-documents-overview",
    title: "How incoming documents work",
    category: "Documents & automation",
    tags: ["incoming", "upload", "email", "receipt", "scan", "ocr"],
    summary: "Forward or upload receipts and supplier invoices for review before they become expenses or bills.",
    planNote: "Incoming documents are available on Professional plans and above.",
    steps: [
      "Open Incoming documents from the sidebar.",
      "Upload a file or forward email to your Finza inbound address (set up under Settings → Inbound email).",
      "Finza extracts amounts and supplier details — review the draft.",
      "Approve and link to an expense or supplier bill, or discard if it is a duplicate.",
      "This saves typing and keeps paper trails in one place.",
    ],
    relatedLinks: [
      { label: "Incoming documents", href: "/service/incoming-documents" },
      { label: "Inbound email settings", href: "/service/settings/inbound-email" },
    ],
  },

  // ── Projects & operations ────────────────────────────────────────────────
  {
    id: "services-catalog",
    title: "How to build your services catalog",
    category: "Projects & operations",
    tags: ["services", "catalog", "price list", "products"],
    summary: "Save services you sell often with default prices for faster invoicing.",
    steps: [
      "Open Services from the sidebar (Services & Materials → Services).",
      "Click Add Service and enter name, description, and default price.",
      "When creating invoices or quotes, pick from the catalog instead of retyping.",
      "Update prices in the catalog when your rates change — existing invoices keep their original prices.",
    ],
    relatedLinks: [{ label: "Services", href: "/service/services" }],
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  {
    id: "view-reports",
    title: "How to view reports",
    category: "Reports",
    tags: ["reports", "profit", "loss", "balance sheet", "cash flow"],
    summary: "Open financial reports for a period — start with Profit & Loss if you are unsure.",
    steps: [
      "Open Reports from the sidebar.",
      "Profit & Loss — money in vs money out for a period (best for 'did we make money?').",
      "Balance Sheet — what you own vs what you owe at a point in time.",
      "Cash Flow — where cash moved during a period.",
      "Choose the date range or accounting period, then review totals.",
      "Some reports need Professional or Business plans — Finza will show if a report is not on your plan.",
    ],
    relatedLinks: [
      { label: "Profit & Loss", href: "/service/reports/profit-and-loss" },
      { label: "Balance Sheet", href: "/service/reports/balance-sheet" },
    ],
  },
  {
    id: "profit-and-loss-explained",
    title: "Profit & Loss explained for business owners",
    category: "Reports",
    tags: ["profit", "loss", "pnl", "revenue", "expenses", "plain language"],
    summary: "Understand your P&L without accounting jargon.",
    steps: [
      "Revenue (or income) — money earned from invoices and sales in the period.",
      "Expenses — business costs recorded in Finza (rent, supplies, salaries, etc.).",
      "Net profit (or loss) — revenue minus expenses. Positive means you earned more than you spent.",
      "The report uses dates you recorded on invoices and expenses — not when cash moved.",
      "Use it monthly to see if your business model is working.",
      "Finza helps organise your books — always confirm tax filings with your accountant or GRA requirements.",
    ],
    relatedLinks: [{ label: "Profit & Loss report", href: "/service/reports/profit-and-loss" }],
  },
  {
    id: "balance-sheet-explained",
    title: "Balance Sheet in plain language",
    category: "Reports",
    tags: ["balance sheet", "assets", "liabilities", "equity"],
    summary: "What you own, what you owe, and what is left for the owners.",
    steps: [
      "Assets — things of value (cash, money customers owe you, equipment).",
      "Liabilities — what the business owes (supplier bills, loans).",
      "Equity — owner's stake; roughly assets minus liabilities.",
      "The report is a snapshot on one date — unlike Profit & Loss which covers a period.",
      "If customer balances look too high, check unpaid invoices. If bills look high, check supplier bills.",
    ],
    relatedLinks: [{ label: "Balance Sheet", href: "/service/reports/balance-sheet" }],
  },
  {
    id: "cash-flow-explained",
    title: "Cash Flow report explained",
    category: "Reports",
    tags: ["cash flow", "cash", "movement"],
    summary: "Follow the movement of cash — not the same as profit.",
    steps: [
      "You can be profitable on paper but short of cash if customers pay late.",
      "Cash Flow shows cash coming in and going out in the period.",
      "Operating activities — day-to-day business (collections, expense payments).",
      "Compare with Profit & Loss: profit includes invoices you sent; cash flow includes money actually received.",
      "Use both reports together to run your business day to day.",
    ],
    relatedLinks: [{ label: "Cash Flow report", href: "/service/reports/cash-flow" }],
  },
  {
    id: "trial-balance-explained",
    title: "What is a trial balance?",
    category: "Reports",
    tags: ["trial balance", "debit", "credit", "ledger", "accountant"],
    planNote: "Trial Balance is typically used on Business plans or with accountant access.",
    summary: "A checklist that debits and credits match — mainly for your accountant.",
    steps: [
      "A trial balance lists every account and its balance at a point in time.",
      "Total debits should equal total credits — that means the books are mathematically balanced.",
      "As a business owner, you rarely need to fix this yourself — your accountant uses it before preparing formal accounts.",
      "If Finza flags an imbalance, contact your accountant or Finza support.",
      "See 'General ledger basics' if you want to understand where these numbers come from.",
    ],
    relatedLinks: [{ label: "Trial Balance", href: "/service/reports/trial-balance" }],
  },

  // ── Tax & Ghana compliance ───────────────────────────────────────────────
  {
    id: "ghana-vat-on-invoices",
    title: "Understanding VAT on your invoices",
    category: "Tax & Ghana compliance",
    tags: ["vat", "nhil", "getfund", "ghana", "tax", "invoice"],
    summary: "How VAT, NHIL, and GETFund appear on invoices you send to customers.",
    steps: [
      "When Ghana taxes are enabled, Finza adds tax lines based on your business settings.",
      "VAT is calculated on the taxable amount of your line items.",
      "NHIL and GETFund may appear as separate lines depending on your configuration.",
      "Tax on invoices affects VAT reports — keep invoice dates accurate.",
      "For filing obligations, use VAT Report and VAT Filings and confirm with your accountant.",
    ],
    relatedLinks: [
      { label: "Invoice settings", href: "/service/settings/invoice-settings" },
      { label: "VAT Report", href: "/reports/vat" },
    ],
  },
  {
    id: "withholding-tax-guide",
    title: "Withholding tax (WHT) — what business owners should know",
    category: "Tax & Ghana compliance",
    tags: ["wht", "withholding", "tax", "ghana", "gra"],
    planNote: "Withholding tax registers are available on Professional plans and above.",
    summary: "When customers or you withhold tax at source, Finza can track it for remittance records.",
    steps: [
      "Some clients withhold tax when paying your invoice — record the withheld amount on the payment.",
      "When you withhold tax from a supplier payment, record it on the supplier bill payment if shown.",
      "Open Withholding Tax under Tax & compliance to review payable and receivable balances.",
      "WHT is a compliance topic — work with your accountant on rates and GRA remittance.",
      "Finza tracks amounts; it does not remit tax to GRA for you.",
    ],
    relatedLinks: [{ label: "Withholding Tax", href: "/service/accounting/wht" }],
  },
  {
    id: "vat-report-guide",
    title: "How to use the VAT Report",
    category: "Tax & Ghana compliance",
    tags: ["vat", "report", "filing", "gra", "return"],
    summary: "Review VAT collected and adjustments before preparing a return.",
    steps: [
      "Open VAT Report from Tax & compliance in the sidebar.",
      "Select the period (usually a month).",
      "Review output VAT (on sales) and input VAT (on purchases) if tracked.",
      "Use VAT Filings to mark returns as filed when submitted to GRA.",
      "Confirm figures with your accountant before submission.",
    ],
    relatedLinks: [
      { label: "VAT Report", href: "/reports/vat" },
      { label: "VAT Filings", href: "/vat-returns" },
    ],
  },

  // ── Accounting & ledger ──────────────────────────────────────────────────
  {
    id: "general-ledger-basics",
    title: "What is the general ledger?",
    category: "Accounting & ledger",
    tags: ["ledger", "journal", "accounts", "bookkeeping"],
    planNote: "General Ledger is available on Business plans or with accountant access.",
    summary: "The master list of every accounting entry — useful with your accountant, not for daily invoicing.",
    steps: [
      "Every invoice, expense, and payment creates accounting entries behind the scenes.",
      "The general ledger lists those entries by account (cash, revenue, expenses, etc.).",
      "You do not need to open it to send invoices or record payments — Finza does that automatically.",
      "Your accountant uses the ledger to prepare year-end accounts and fix rare errors.",
      "Think of it as the engine room — the dashboard and invoices are the steering wheel.",
    ],
    relatedLinks: [{ label: "General Ledger", href: "/service/ledger" }],
  },
  {
    id: "journal-entry-reversals",
    title: "What does reversing a journal entry mean?",
    category: "Accounting & ledger",
    tags: ["reversal", "reverse", "journal", "undo", "mistake", "correction"],
    planNote: "Reversals are usually done by owners, admins, or accountants on Business plans.",
    summary: "A reversal cancels an earlier accounting entry — like an undo for the books, not for invoices.",
    steps: [
      "A journal entry (JE) is a formal accounting record. Reversing it creates an opposite entry to cancel the effect.",
      "Reversals do not delete history — both the original and reversal stay visible for audit.",
      "Common reasons: duplicate posting, wrong amount posted to accounts, or accountant correction.",
      "Reversing is not the same as a credit note — credit notes adjust customer invoices; reversals fix accounting entries.",
      "If you posted an invoice incorrectly, speak to your accountant before reversing ledger entries.",
      "Only users with accounting access should reverse entries. When in doubt, contact Finza support.",
    ],
    relatedLinks: [
      { label: "General Ledger", href: "/service/ledger" },
      { label: "Accounting Audit Log", href: "/service/accounting/audit" },
    ],
  },
  {
    id: "bank-reconciliation-guide",
    title: "Bank reconciliation step by step",
    category: "Accounting & ledger",
    tags: ["bank", "reconciliation", "match", "csv", "statement"],
    planNote: "Bank reconciliation is available on Business plans or with accountant access.",
    summary: "Match Finza records to your bank statement so cash balances are trustworthy.",
    steps: [
      "Open Bank Reconciliation under Advanced accounting.",
      "Import or enter transactions from your bank statement (CSV where supported).",
      "Match each bank line to a payment, expense, or transfer in Finza.",
      "Unmatched items may be missing entries — record them or mark for review.",
      "When everything matches, your Finza cash balance aligns with the bank.",
      "Do this monthly — it catches missed MoMo transfers and bank fees early.",
    ],
    relatedLinks: [{ label: "Bank Reconciliation", href: "/service/accounting/bank-reconciliation" }],
  },
  {
    id: "owner-withdrawal-contribution",
    title: "Owner withdrawal vs owner contribution",
    category: "Accounting & ledger",
    tags: ["owner", "withdrawal", "contribution", "drawing", "capital"],
    planNote: "Owner movements are under Advanced accounting.",
    summary: "Money you take out or put into the business is not the same as an expense or invoice.",
    steps: [
      "Owner withdrawal — you take money from the business for personal use. It reduces equity, not a deductible expense.",
      "Owner contribution — you put personal money into the business (e.g. top up MoMo float).",
      "Do not record owner drawings as regular expenses — that distorts your Profit & Loss.",
      "Use Accounting → Owner contribution or withdrawal (or ask your accountant to post).",
      "Keep a simple log of personal vs business spending even before you enter it in Finza.",
    ],
    relatedLinks: [
      { label: "Owner contribution", href: "/service/accounting/contribution" },
      { label: "Accounting home", href: "/service/accounting" },
    ],
  },
  {
    id: "accounting-periods-closing",
    title: "Accounting periods and closing",
    category: "Accounting & ledger",
    tags: ["period", "close", "month end", "year end", "lock"],
    planNote: "Period close is an advanced accounting feature.",
    summary: "Why Finza splits time into periods and what happens when a period is closed.",
    steps: [
      "An accounting period is usually a month — Finza uses it for reports and dashboard totals.",
      "Closing a period locks past entries so reports for that month stay stable.",
      "You cannot casually edit closed periods — that protects your records for tax and audit.",
      "Your accountant may close periods after reviewing the month.",
      "If you need to fix something in a closed period, ask your accountant or Finza support.",
    ],
    relatedLinks: [{ label: "Accounting periods", href: "/service/accounting/periods" }],
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    id: "run-payroll-basics",
    title: "How to run payroll (basics)",
    category: "Payroll",
    tags: ["payroll", "salary", "payslip", "staff", "pay"],
    planNote: "Payroll features depend on your Finza plan.",
    summary: "Overview of creating a payroll run and paying employees through Finza.",
    steps: [
      "Add employees under Payroll → Employees with salary and deduction details.",
      "Start a new payroll run for the pay period.",
      "Review payslips and totals before approving.",
      "Record salary payments when you pay staff (bank or MoMo).",
      "Keep payslips for employee records and statutory requirements.",
      "For complex payroll or statutory filings, confirm with your accountant.",
    ],
    relatedLinks: [
      { label: "Payroll", href: "/service/payroll" },
      { label: "Employees", href: "/service/payroll/staff" },
    ],
  },

  // ── Team & permissions ───────────────────────────────────────────────────
  {
    id: "team-roles-permissions",
    title: "Team roles and permissions explained",
    category: "Team & permissions",
    tags: ["team", "role", "permission", "access", "staff"],
    planNote: "Team management is available on Professional plans and above.",
    summary: "Who can create invoices, see reports, or change settings in your workspace.",
    steps: [
      "Owner — full access including billing and team management.",
      "Admin — nearly full access; good for a trusted manager.",
      "Manager — can run day-to-day operations; may have limited settings access.",
      "Staff — narrower access (e.g. create invoices but not see all reports).",
      "Accountant — focused on accounting views and reports you grant.",
      "You can adjust individual permissions beyond the default role.",
    ],
    relatedLinks: [{ label: "Team members", href: "/service/settings/team" }],
  },
  {
    id: "invite-team-member",
    title: "How to invite a team member",
    category: "Team & permissions",
    tags: ["team", "invite", "staff", "permissions"],
    planNote: "Team invitations are available on Professional plans and above.",
    summary: "Give colleagues access to your Finza business with the right permissions.",
    steps: [
      "Open Team members under Organization or Settings.",
      "Click Invite or Add team member.",
      "Enter their email and choose a role (admin, manager, staff, etc.).",
      "They receive an invitation to join your business workspace.",
      "Adjust permissions later from the team settings page if needed.",
    ],
    relatedLinks: [{ label: "Team members", href: "/service/settings/team" }],
  },
  {
    id: "audit-logs-explained",
    title: "Full Audit Log vs Accounting Audit Log",
    category: "Team & permissions",
    tags: ["audit", "log", "history", "compliance", "who changed"],
    summary: "See who changed what — useful for trust and troubleshooting.",
    steps: [
      "Full Audit Log — business-wide actions (invoices, settings, team changes).",
      "Accounting Audit Log — ledger and accounting-specific changes.",
      "Use audit logs to answer 'who deleted this?' or 'when was this payment recorded?'",
      "Most day-to-day users never need audit logs — owners and accountants use them most.",
    ],
    relatedLinks: [
      { label: "Full Audit Log", href: "/audit-log" },
      { label: "Accounting Audit Log", href: "/service/accounting/audit" },
    ],
  },

  // ── Settings & integrations ──────────────────────────────────────────────
  {
    id: "update-business-info",
    title: "How to update business information",
    category: "Settings & integrations",
    tags: ["business", "profile", "logo", "settings"],
    summary: "Update your business name, logo, and details shown on invoices and receipts.",
    steps: [
      "Open Settings → All settings from the sidebar.",
      "Edit business profile: trading name, address, phone, and tax details as needed.",
      "Upload or change your logo if you want it on invoices and documents.",
      "Save changes — new documents use the updated information.",
    ],
    relatedLinks: [{ label: "Settings", href: "/service/settings" }],
  },
  {
    id: "payment-integrations-momo",
    title: "Manual MoMo and bank payment instructions",
    category: "Settings & integrations",
    tags: ["momo", "mobile money", "payment", "manual", "bank", "transfer"],
    summary: "Show customers your MoMo or bank details on invoices when they pay you directly.",
    steps: [
      "Open Settings → Payment integrations.",
      "Under Manual wallet (MoMo / transfer), enter your network, account name, and wallet number.",
      "Add short instructions if helpful (e.g. 'Use invoice number as reference').",
      "Enable manual wallet and save.",
      "Customers see these details on the public invoice when Hubtel checkout is not configured.",
      "When money arrives, you must still record the payment on the invoice in Finza — manual payments are not confirmed automatically.",
      "For online checkout with MoMo/card via Hubtel, see 'How to set up Hubtel payments'.",
    ],
    relatedLinks: [
      { label: "Payment integrations", href: "/service/settings/payments" },
      { label: "Hubtel setup guide", href: "/help/setup-hubtel-payments" },
    ],
  },
  {
    id: "setup-hubtel-payments",
    title: "How to set up Hubtel payments on invoices",
    category: "Settings & integrations",
    tags: ["hubtel", "online checkout", "momo", "card", "payment", "collection", "ghana"],
    summary: "Let customers pay sent invoices online through Hubtel — Finza records the payment when Hubtel confirms it.",
    steps: [
      "You need a Hubtel merchant account with Online Checkout enabled. Get your API ID, API Key, and Collection Account Number from Hubtel.",
      "In Finza, open Settings → All settings → Hubtel integration (or Settings → Integrations → Hubtel).",
      "Tick Enable Hubtel invoice checkout.",
      "Select Live environment — customer invoice payments always use Live credentials, not Test.",
      "Enter your Collection Account Number (Hubtel merchant / collection account).",
      "Enter Hubtel API ID and API Key, then Save. Credentials are encrypted and hidden after saving.",
      "Check Current status shows Connected and Invoice checkout Ready.",
      "Send an invoice to a customer — their public invoice link shows Pay with Hubtel when checkout is configured.",
      "After the customer pays, Finza verifies the transaction with Hubtel and records the payment on the invoice automatically.",
      "Manual MoMo instructions on Payment integrations are separate — use those only when Hubtel is not configured.",
    ],
    relatedLinks: [
      { label: "Hubtel integration", href: "/service/settings/integrations/hubtel" },
      { label: "Payment integrations", href: "/service/settings/payments" },
      { label: "Record a customer payment", href: "/help/record-payment" },
    ],
  },
  {
    id: "hubtel-customer-payment-flow",
    title: "What your customer sees when paying with Hubtel",
    category: "Settings & integrations",
    tags: ["hubtel", "customer", "pay", "checkout", "public invoice"],
    summary: "Step-by-step for your customer — useful when explaining how to pay online.",
    steps: [
      "You send the invoice by email or WhatsApp — the customer opens the invoice link.",
      "If Hubtel is configured, they see Pay with Hubtel on the invoice or payment page.",
      "They click the button and are redirected to Hubtel's secure checkout (MoMo, card, or other Hubtel options).",
      "They complete payment on Hubtel and return to Finza.",
      "Finza confirms payment with Hubtel before marking the invoice paid — this may take a moment.",
      "You can send a receipt after the invoice shows as paid.",
      "If they paid but the invoice still shows unpaid, see 'Hubtel payment not showing on invoice'.",
    ],
    relatedLinks: [
      { label: "Send an invoice", href: "/help/send-invoice" },
      { label: "Hubtel setup", href: "/help/setup-hubtel-payments" },
    ],
  },
  {
    id: "hubtel-payment-troubleshooting",
    title: "Hubtel payment not showing on invoice",
    category: "Troubleshooting",
    tags: ["hubtel", "pending", "verification", "paid", "not updated", "retry"],
    summary: "Customer paid via Hubtel but the invoice is still unpaid — what to check.",
    steps: [
      "Ask the customer for Hubtel confirmation (SMS or receipt) and the amount paid.",
      "Open Settings → Hubtel integration and scroll to Hubtel pending verification.",
      "If the payment appears there, click Retry verification on that row (or Retry all).",
      "Finza only marks the invoice paid after Hubtel confirms the transaction — do not record a duplicate manual payment unless you are sure Hubtel did not succeed.",
      "Check that Live API credentials and Collection Account Number are correct.",
      "Ensure invoice checkout is enabled and status shows Connected.",
      "If pending verification keeps failing, contact Finza support with the invoice number and Hubtel reference.",
      "As a last resort for cash already received outside Hubtel, record payment manually on the invoice — but avoid double-counting if Hubtel later confirms.",
    ],
    relatedLinks: [
      { label: "Hubtel integration", href: "/service/settings/integrations/hubtel" },
      { label: "Contact support", href: "/help/contact" },
    ],
  },

  // ── Troubleshooting ──────────────────────────────────────────────────────
  {
    id: "contact-support",
    title: "How to contact Finza support",
    category: "Troubleshooting",
    tags: ["support", "help", "contact", "bug"],
    summary: "Reach Finza when you are stuck or need help with your account.",
    steps: [
      "Open Help & Support from the sidebar or dashboard.",
      "Search articles — many common questions are answered there.",
      "If you still need help, click Contact Finza Support.",
      "Choose a category, describe your issue, and submit the form.",
      "Our team will follow up using your account email. For urgent billing issues, mark urgency as urgent.",
    ],
    relatedLinks: [{ label: "Help home", href: "/help" }],
  },
]

export const POPULAR_HELP_ARTICLE_IDS = [
  "create-invoice",
  "record-payment",
  "setup-hubtel-payments",
  "create-credit-note",
  "apply-credit-note",
  "send-receipt",
  "unpaid-invoices",
  "dashboard-metrics-explained",
  "quote-proforma-invoice-explained",
  "journal-entry-reversals",
  "profit-and-loss-explained",
  "ghana-vat-on-invoices",
] as const

/** Articles grouped and ordered for browse UI. */
export function getHelpArticlesGroupedByCategory(): Array<{
  category: HelpCategory
  description: string
  articles: HelpArticle[]
}> {
  return HELP_CATEGORIES.map((category) => ({
    category,
    description: HELP_CATEGORY_META[category].description,
    articles: HELP_ARTICLES.filter((a) => a.category === category),
  })).filter((group) => group.articles.length > 0)
}

export function getHelpArticleById(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id)
}

export function searchHelpArticles(query: string): HelpArticle[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return HELP_ARTICLES
  return HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.title,
      article.summary,
      article.category,
      article.planNote ?? "",
      ...article.tags,
    ]
      .join(" ")
      .toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

export function getHelpArticlesByCategory(category: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category)
}
