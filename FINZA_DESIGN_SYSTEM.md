# FINZA Design System

## 1. Financial Color Semantics

These colors are chosen for their semantic meaning in an accounting context, ensuring accessibility and clarity.

### Money In (Assets, Income, Payments)
*   **Token:** `emerald`
*   **Primary:** `#10b981` (emerald-500) - Large positive values, 'Paid' badges
*   **Surface:** `#d1fae5` (emerald-100) - Backgrounds for positive rows
*   **Text:** `#065f46` (emerald-800) - Text on emerald surfaces
*   **Usage:** Cash receipts, Invoice payments, Asset accounts.
*   *Note:* Avoid bright "lime" greens which feel unprofessional.

### Money Out (Liabilities, Expenses, Refunds)
*   **Token:** `slate` (Primary) / `rose` (Critical)
*   **Primary:** `#64748b` (slate-500) - Standard expenses, negative values (neutral)
*   **Critical:** `#e11d48` (rose-600) - Overdue, Errors, Destructive actions
*   **Text:** `#f1f5f9` (slate-100) or `#fff1f2` (rose-50)
*   **Usage:** Expenses are often displayed in neutral Slate to avoid a "sea of red". Red is reserved for *problems* (Overdue) or *exceptions* (Refunds).

### Pending (Drafts, Unsent, Processing)
*   **Token:** `gray`
*   **Primary:** `#9ca3af` (gray-400)
*   **Surface:** `#f3f4f6` (gray-100)
*   **Usage:** Draft invoices, Unposted journals.

### Locked (Closed Periods, Reconciled)
*   **Token:** `amber`
*   **Primary:** `#d97706` (amber-600)
*   **Surface:** `#fef3c7` (amber-100)
*   **Usage:** Closed accounting periods, Reconciled statements (visual warning that change is restricted).

### System State (Neutral, text, borders)
*   **Canvas:** `#ffffff` (white) / `#0f172a` (slate-900 dark)
*   **Panel:** `#f8fafc` (slate-50) / `#1e293b` (slate-800 dark)
*   **Border:** `#e2e8f0` (slate-200) / `#334155` (slate-700 dark)
*   **Text Primary:** `#0f172a` (slate-900) / `#f8fafc` (slate-50)
*   **Text Secondary:** `#64748b` (slate-500)

---

## 2. Typography System

### Font Families
*   **UI / Body:** `Inter` (Variable) - Clean, legible, modern.
*   **Numbers / Data:** `JetBrains Mono` - Monospaced, distinct digits (0 vs O), ensures tabular alignment.

### Rules
1.  **Tabular Numbers:** All financial tables MUST use `font-mono` or `font-variant-numeric: tabular-nums` to ensure decimal alignment.
2.  **Right Alignment:** All monetary values must be right-aligned.
3.  **Headings:** `font-sans font-semibold tracking-tight`.
4.  **Data Density:** `text-sm` (14px) is the default for tables. `text-xs` (12px) for metadata/secondary info.

---

## 3. Status Badge Language

Badges use a transparent background with bold text for readability.

| Status | Color | Visual Meaning |
| :--- | :--- | :--- |
| **Invoice: DRAFT** | `bg-gray-100 text-gray-700` | Editable, Not on Ledger |
| **Invoice: SENT** | `bg-blue-100 text-blue-700` | Locked, Awaiting Payment |
| **Invoice: PAID** | `bg-emerald-100 text-emerald-700` | Settled, Cash Received |
| **Invoice: OVERDUE** | `bg-rose-100 text-rose-700` | Action Required Immediately |
| **Invoice: VOID** | `bg-slate-100 text-slate-500 line-through` | Nullified, Reversal Exists |
| **Period: OPEN** | `bg-emerald-50 text-emerald-600 border border-emerald-200` | Active Posting Allowed |
| **Period: SOFT CLOSE** | `bg-amber-50 text-amber-600 border border-amber-200` | Warn before posting |
| **Period: LOCKED** | `bg-slate-100 text-slate-800 border border-slate-300` | Immutable |

---

## 4. Financial Document Layout Standards

### A. The "Paper Metaphor" Container
Financial documents (Invoices, Credit Notes) must look like physical documents to instil trust.
*   **Container:** White background, subtle shadow (`shadow-sm`), distinct border (`border-slate-200`).
*   **Padding:** `p-8` (32px) minimum on desktop to mimic page margins.
*   **Header:** Standard location for Logo (Top Left) vs Document Meta (Top Right).

### B. Master-Detail Layouts
*   **Header Section:** Customer details, Dates, References.
*   **Lines Section:** Table with explicit columns: `Item | Qty | Price | Tax | Total`.
*   **Footer Section:** Subtotals, Tax Breakdown (CRITICAL for Ghana compliance), Grand Total.

### C. The "Ledger Strip"
For Journal Entries and Adjustments:
*   Use a continuous strip design for Credit/Debit columns.
*   **Debit:** Left-aligned numbers or specific column.
*   **Credit:** Right-aligned numbers or specific column.
*   **Balance Indicator:** Always show `DR = CR` verification at the bottom.

---

## 5. Confirmation & Destructive Action Standards

### Destructive Actions (Void, Delete)
*   **Pattern:** Double-Confirmation Modal.
*   **Language:** "Voiding this invoice will create a reversing journal entry. This cannot be undone."
*   **Input:** User must type "VOID" or "DELETE" for critical data destruction (e.g., nuking a client).

### Period Closing
*   **Pattern:** Checklist Modal.
*   **Requirements:** "Confirm Bank Reconciliation", "Review Suspense Account", "Lock Sub-ledgers".
*   **Action:** "Close Period" button changes color to `amber` (Caution).

---

## 6. Dashboard Information Hierarchy

### Ordering Logic
1.  **Health Alerts (Top):** "3 Invoices Overdue", "Period Closing Soon", "Bank Feed Disconnected".
2.  **Cash Position (Key Metric):** "Cash on Hand" vs "Short-term Liability".
3.  **Performance (Trends):** Revenue vs Expenses graph.
4.  **Operational List:** "Recent Transactions" or "Drafts waiting for approval".

### Constraints
*   **No "Vanity Metrics":** Do not show "Total Invoices Sent" if 90% are unpaid. Show "Collections Efficiency".
*   **Empty States:** If no data, show "Setup Guide" or "Create your first Invoice", not empty charts.
