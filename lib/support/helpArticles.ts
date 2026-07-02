export type HelpArticle = {
  id: string
  title: string
  category: string
  tags: string[]
  summary: string
  steps: string[]
  relatedLinks?: {
    label: string
    href: string
  }[]
}

export const HELP_CATEGORIES = [
  "Getting started",
  "Invoices",
  "Credit notes",
  "Receipts",
  "Payments",
  "Customers",
  "Expenses",
  "Bills",
  "Payroll",
  "Reports",
  "Settings",
  "Team members",
  "Troubleshooting",
] as const

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "create-invoice",
    title: "How to create an invoice",
    category: "Invoices",
    tags: ["invoice", "billing", "new", "create"],
    summary: "Create a draft invoice, add your customer and line items, then send it when ready.",
    steps: [
      "Open Invoices from the sidebar (Billing → Invoices).",
      "Click New Invoice or Create Invoice.",
      "Choose a customer (or add one first under Customers).",
      "Add line items — description, quantity, and price. Finza calculates tax if your business uses Ghana taxes.",
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
    tags: ["invoice", "send", "email", "whatsapp"],
    summary: "Send a draft or already-issued invoice by email or WhatsApp.",
    steps: [
      "Open the invoice from your Invoices list.",
      "If the invoice is still a draft, click Send and choose Email or WhatsApp.",
      "Check the customer contact details are correct before sending.",
      "For a sent invoice, use Send again if you need to resend the link or PDF.",
      "Your customer receives a link to view the invoice online.",
    ],
    relatedLinks: [{ label: "Invoices list", href: "/service/invoices" }],
  },
  {
    id: "record-payment",
    title: "How to record a customer payment",
    category: "Payments",
    tags: ["payment", "paid", "cash", "momo", "bank"],
    summary: "Record money your customer paid against an invoice.",
    steps: [
      "Open the invoice you received payment for.",
      "Click Record Payment or Add Payment.",
      "Enter the amount, date, and payment method (cash, mobile money, bank transfer, etc.).",
      "Add a reference or note if helpful (e.g. MoMo transaction ID).",
      "Save — Finza updates how much is still outstanding on the invoice.",
    ],
    relatedLinks: [
      { label: "Payments list", href: "/service/payments" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "send-receipt",
    title: "How to send or view a receipt",
    category: "Receipts",
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
  {
    id: "create-credit-note",
    title: "How to create a credit note",
    category: "Credit notes",
    tags: ["credit note", "refund", "adjustment", "invoice"],
    summary: "Issue a credit note when you need to reduce what a customer owes on an invoice.",
    steps: [
      "Open Credit Notes from the sidebar, or click Issue Credit Note on an invoice.",
      "Select the invoice you are adjusting (must be sent, paid, or overdue — not draft).",
      "Add credit lines — amount, description, and quantity as needed.",
      "Save and apply the credit note when you are ready.",
      "Applied credits reduce the outstanding balance on the invoice. You can issue more than one credit note up to the invoice total.",
    ],
    relatedLinks: [
      { label: "Credit notes", href: "/service/credit-notes" },
      { label: "Invoices", href: "/service/invoices" },
    ],
  },
  {
    id: "invoice-paid-partial",
    title: "Why is an invoice paid or partially paid?",
    category: "Invoices",
    tags: ["paid", "partial", "status", "balance"],
    summary: "Finza updates invoice status from payments and applied credit notes — not manually.",
    steps: [
      "Paid means recorded payments plus applied credits cover the invoice total.",
      "Partially paid means some payment or credit was applied, but money is still outstanding.",
      "Sent or overdue means no payment (or not enough) has been recorded yet.",
      "Check the invoice’s Payments section to see what was recorded and when.",
      "If the balance looks wrong, confirm all payments and credit notes are entered correctly.",
    ],
    relatedLinks: [{ label: "Invoices", href: "/service/invoices" }],
  },
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
    id: "add-expense",
    title: "How to add an expense",
    category: "Expenses",
    tags: ["expense", "cost", "spending"],
    summary: "Record business spending for your records and reports.",
    steps: [
      "Open Expenses from the sidebar (Billing → Expenses).",
      "Click Record Expense or New Expense.",
      "Enter date, amount, category, and description.",
      "Attach a receipt photo or file if you have one.",
      "Save — the expense appears in your expense list and reports.",
    ],
    relatedLinks: [{ label: "Expenses", href: "/service/expenses" }],
  },
  {
    id: "add-supplier-bill",
    title: "How to add a supplier bill",
    category: "Bills",
    tags: ["bill", "supplier", "payable"],
    summary: "Track money you owe suppliers before you pay them.",
    steps: [
      "Open Supplier Bills from the sidebar (available on Professional plans and above).",
      "Click New Bill and enter supplier name, bill number, and line items.",
      "Set issue and due dates.",
      "Save — record payments against the bill when you pay the supplier.",
    ],
    relatedLinks: [{ label: "Supplier bills", href: "/service/bills" }],
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
      "An invoice past its due date with money still owed may show as overdue.",
      "Use the dashboard and invoice list to follow up with customers who owe you.",
      "Record payments when money arrives so balances stay accurate.",
    ],
    relatedLinks: [
      { label: "Invoices", href: "/service/invoices" },
      { label: "Dashboard", href: "/service/dashboard" },
    ],
  },
  {
    id: "update-business-info",
    title: "How to update business information",
    category: "Settings",
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
    id: "invite-team-member",
    title: "How to invite a team member",
    category: "Team members",
    tags: ["team", "invite", "staff", "permissions"],
    summary: "Give colleagues access to your Finza business with the right permissions.",
    steps: [
      "Open Team members under Organization (Professional plan and above).",
      "Click Invite or Add team member.",
      "Enter their email and choose a role (e.g. admin, staff with limited access).",
      "They receive an invitation to join your business workspace.",
      "You can adjust permissions later from the team settings page.",
    ],
    relatedLinks: [{ label: "Team members", href: "/service/settings/team" }],
  },
  {
    id: "use-dashboard",
    title: "How to use the dashboard",
    category: "Getting started",
    tags: ["dashboard", "overview", "summary"],
    summary: "Your dashboard shows a quick picture of revenue, cash, and what needs attention.",
    steps: [
      "Open Dashboard from the sidebar when you sign in.",
      "Review revenue and expenses for the current period.",
      "Check unpaid or overdue invoices in the collections section.",
      "Use quick actions to create invoices, record expenses, or view reports.",
      "Change the period dropdown to compare earlier months if needed.",
    ],
    relatedLinks: [{ label: "Dashboard", href: "/service/dashboard" }],
  },
  {
    id: "view-reports",
    title: "How to view reports",
    category: "Reports",
    tags: ["reports", "profit", "loss", "balance sheet"],
    summary: "Run Profit & Loss, Balance Sheet, and other reports for your business.",
    steps: [
      "Open Reports from the sidebar (e.g. Profit & Loss or Balance Sheet).",
      "Choose the date range or accounting period you need.",
      "Review totals — reports use your recorded invoices, expenses, and ledger entries.",
      "Export or print if your plan includes those options.",
      "For tax filings, use VAT Report or VAT Filings where available.",
    ],
    relatedLinks: [
      { label: "Profit & Loss", href: "/service/reports/profit-and-loss" },
      { label: "Balance Sheet", href: "/service/reports/balance-sheet" },
    ],
  },
  {
    id: "contact-support",
    title: "How to contact Finza support",
    category: "Troubleshooting",
    tags: ["support", "help", "contact", "bug"],
    summary: "Reach Finza when you are stuck or need help with your account.",
    steps: [
      "Open Help & Support from the sidebar.",
      "Search articles above — many common questions are answered there.",
      "If you still need help, click Contact Finza Support on this page.",
      "Choose a category, describe your issue, and submit the form.",
      "Our team will follow up using your account email. For urgent billing issues, mark urgency as urgent.",
    ],
    relatedLinks: [{ label: "Help home", href: "/help" }],
  },
]

export const POPULAR_HELP_ARTICLE_IDS = [
  "create-credit-note",
  "send-receipt",
  "create-invoice",
  "record-payment",
  "add-expense",
  "unpaid-invoices",
  "update-business-info",
] as const

export function getHelpArticleById(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id)
}

export function searchHelpArticles(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase()
  if (!q) return HELP_ARTICLES
  return HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.title,
      article.summary,
      article.category,
      ...article.tags,
    ]
      .join(" ")
      .toLowerCase()
    return haystack.includes(q)
  })
}

export function getHelpArticlesByCategory(category: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category)
}
