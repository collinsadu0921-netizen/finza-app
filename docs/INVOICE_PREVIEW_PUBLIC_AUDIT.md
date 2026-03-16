# Invoice Preview & Public Page — Design Audit

## Step 1 — Audit Report

### 1. Create Invoice Page (design reference — "gold standard")

- **File path:** `app/invoices/new/page.tsx`
- **UI library:** Tailwind CSS. Custom components: `StatusBadge`, `Money` from `@/components/ui`. No shadcn.
- **Visual style:** Modern card-based. Light gray background (`bg-gray-50/50`), single white card with subtle shadow and slate border. Generous section padding (`p-8`). Clear hierarchy: uppercase tracking labels, slate-900 headings, muted slate-500 for secondary text.
- **Design tokens:**
  - **Background:** `min-h-screen bg-gray-50/50`
  - **Card:** `bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200`
  - **Section padding:** `p-8`, `border-t border-slate-200`
  - **Labels:** `text-xs font-bold text-slate-500 uppercase tracking-wider`
  - **Headings:** `text-2xl font-bold text-slate-900`, `text-sm text-slate-500`
  - **Table:** `thead bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 uppercase border-b border-slate-200`, `tbody divide-y divide-slate-100`, cells `px-6 py-3`
  - **Totals:** `flex justify-between`, subtotal/tax `text-sm text-slate-600`, total `text-base font-bold` / `text-xl font-bold text-slate-900`, `border-y border-slate-100`
  - **Buttons:** Secondary = `bg-white border border-slate-300 rounded shadow-sm text-slate-700`; Primary = `bg-slate-900 text-white rounded shadow`; Preview = `bg-indigo-50 border border-indigo-200 text-indigo-700 rounded shadow-sm`
  - **StatusBadge:** Uses `StatusBadge` with semantic colors (draft=gray, paid=emerald, overdue=rose, sent=blue)

---

### 2. Invoice Preview

- **File path:** `components/invoices/InvoicePreviewModal.tsx` (wrapper) + HTML from `components/documents/FinancialDocument.ts` (via `GET /api/invoices/[id]/pdf-preview` or `POST /api/invoices/preview-draft`).
- **UI library:** Modal: Tailwind. Content: raw HTML string (iframe) — no React components inside the preview body.
- **Visual style:** Modal is modern (rounded-2xl, shadow-xl). The **document inside the iframe** uses inline CSS in FinancialDocument: gray/blue palette (#f5f5f5, #e5e7eb, #1f2937, #6b7280, #2563eb gradient logo). Feels flatter and denser than the create page; different typography (no slate, no uppercase tracking labels).
- **Inconsistencies with create page:**
  - Uses gray (#f5f5f5, #e5e7eb, #6b7280) instead of slate.
  - Labels are "From" / "To" and date labels — not the same uppercase tracking style.
  - No status badge in the document.
  - Table thead #f9fafb; create uses slate-50.
  - Totals block is 300px right-aligned with different spacing/hierarchy.
  - Card: 800px container, 40px padding, different shadow — create uses max-w-4xl, p-8, shadow-sm.

---

### 3. Public Invoice Page

- **File path:** `app/invoice-public/[token]/page.tsx`
- **UI library:** Tailwind, `BusinessLogoDisplay`, `useToast`. Custom status pill (no StatusBadge).
- **Visual style:** Card-based but different palette: gray-50 background, gray-100/200 borders, gray-600/900 text. Feels consistent with itself but not with the create page.
- **Inconsistencies with create page:**
  - **Palette:** gray-50, gray-100, gray-200, gray-600, gray-900 instead of slate.
  - **Status badge:** Custom pills (`bg-green-100 text-green-800`, `bg-red-100 text-red-800`, `bg-amber-100 text-amber-800`) instead of `StatusBadge` (emerald/rose/amber with border).
  - **Card:** `rounded-lg shadow-lg p-8` — create uses `shadow-sm border border-slate-200`.
  - **Labels/sections:** "Bill To:", "Issue Date:", table headers — different from create’s uppercase tracking-wider labels.
  - **Table:** `border border-gray-300`, `bg-gray-100` thead — create uses slate-50, divide-y divide-slate-100.
  - **Totals:** Different spacing and no clear match to create’s subtotal/tax/total hierarchy.
  - **Buttons:** Download PDF = `bg-gray-800`; Pay = `bg-green-600`. Create uses slate-900 primary; green is acceptable for Pay but style (rounded-lg) differs.

---

## Step 2 — Design Rules (extracted from create page)

- **Background:** `bg-gray-50/50` (page), `bg-white` (card).
- **Card:** `rounded-lg shadow-sm border border-slate-200`, overflow-hidden, max-w-4xl mx-auto.
- **Section padding:** `p-8`, section dividers `border-t border-slate-200`.
- **Typography:** Labels `text-xs font-bold text-slate-500 uppercase tracking-wider`; headings `text-2xl font-bold text-slate-900`; body `text-sm text-slate-600`/`text-slate-700`; total `text-base`/`text-xl font-bold text-slate-900`.
- **Table:** `thead bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-200`, `th px-6 py-3 font-semibold`, `tbody divide-y divide-slate-100`, `td px-6 py-3`.
- **Totals block:** Right-aligned, `space-y-3`; rows `flex justify-between text-sm text-slate-600`; total row `pt-2` with `text-base font-bold` / `text-xl font-bold text-slate-900`.
- **Status badge:** Use `StatusBadge` — paid=emerald, overdue=rose, unpaid/sent=amber/blue, draft=gray.
- **Buttons:** Primary = `bg-slate-900 text-white rounded shadow-sm`; secondary = `border border-slate-300 rounded shadow-sm text-slate-700`; success (Pay) = `bg-emerald-600` or green-600, same rounding.

---

## Step 3 & 4 — Implementation

- **Shared component:** Add `components/invoices/InvoiceDocument.tsx` — React component that renders the invoice document (header, bill to, meta, line items table, totals, notes/footer) using the create-page design tokens above. Accepts props: invoice, business, items, settings (optional), currencySymbol, status.
- **Public page:** Use `<InvoiceDocument />` for the document body; keep action bar (Download PDF, Pay online) and payment options block in `.no-print` with the same design language (slate, StatusBadge, button styles).
- **Preview:** Keep iframe flow. Update `FinancialDocument.ts` (HTML string) to use the same palette and typography (slate equivalents in inline CSS) so the iframe content matches the create page and the new public document. No change to InvoicePreviewModal structure.
