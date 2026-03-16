# Customer Statement – `currencySymbol is not defined` (Audit)

## Objective

Determine where `currencySymbol` is expected to come from and why the Customer Statement page crashes.

**Rules:** Read-only. No variable declarations. No fixes.

---

## 1. All References to `currencySymbol`

| Line | Context |
|------|--------|
| **109** | WhatsApp message template: `` `...Total Outstanding: ${currencySymbol \|\| ""}${summary?.totalOutstanding.toFixed(2) \|\| "0.00"}.` `` |
| **258** | Summary card: `{currencySymbol \|\| ""}{summary.totalInvoiced.toFixed(2)}` |
| **262** | Summary card: `{currencySymbol \|\| ""}{summary.totalPaid.toFixed(2)}` |
| **267** | Summary card: `-{currencySymbol \|\| ""}{summary.totalCredits.toFixed(2)}` |
| **272** | Summary card: `{currencySymbol \|\| ""}{summary.totalOutstanding.toFixed(2)}` |
| **276** | Summary card: `{currencySymbol \|\| ""}{summary.totalOverdue.toFixed(2)}` |
| **304** | Invoice total: `{currencySymbol \|\| ""}{Number(invoice.total).toFixed(2)}` |
| **306** | Invoice balance: `Balance: {currencySymbol \|\| ""}{balance.toFixed(2)}` |
| **319** | Payment amount: `{currencySymbol \|\| ""}{Number(payment.amount).toFixed(2)}` |
| **333** | Credit note total: `-{currencySymbol \|\| ""}{Number(creditNote.total).toFixed(2)}` |

**Total: 10 references.** All use `currencySymbol || ""`; none define it.

---

## 2. Where `currencySymbol` SHOULD Be Defined

| Source | Details |
|--------|---------|
| **Hook** | `useBusinessCurrency()` from `@/lib/hooks/useBusinessCurrency` |
| **Hook provides** | `currencySymbol: string \| null` (from `getCurrencySymbol(business.default_currency)`) |
| **Ultimate source** | Business settings: `business.default_currency` → `getCurrencySymbol(code)` |

**Expected pattern (as used elsewhere):**
- `app/customers/[id]/360/page.tsx` (line 52): `const { currencyCode, currencySymbol } = useBusinessCurrency()`
- `app/estimates/[id]/view/page.tsx` (line 50): `const { currencySymbol } = useBusinessCurrency()`

The statement page **imports** `useBusinessCurrency` (line 6) but **does not call it**. No destructuring, no `currencySymbol` in scope.

---

## 3. Existence in File and Imports

| Item | Present? | Location |
|------|----------|----------|
| **Import** | Yes | Line 6: `import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"` |
| **Hook invocation** | **No** | No `useBusinessCurrency()` call in the component |
| **State / local var** | **No** | No `useState` or `let`/`const` for `currencySymbol` |
| **Prop** | No | Component has no props; `currencySymbol` is not passed in |
| **Context** | No | No React context consumed for currency |

**Conclusion:** `currencySymbol` is used but never declared or derived. The hook that would supply it is imported but never used.

---

## 4. Root Cause Classification

| Classification | Applicable? | Reason |
|----------------|-------------|--------|
| **Missing import** | No | `useBusinessCurrency` is imported. |
| **Missing derivation** | **Yes** | Hook is imported but **never called**. `currencySymbol` must be derived via `const { currencySymbol } = useBusinessCurrency()`. That call is absent. |
| **Removed refactor artifact** | Partially | Usages of `currencySymbol` exist (likely added when replacing hardcoded "₵"/"GHS"). The **definition** (hook call) was either never added or was removed in a refactor. The variable was never introduced in this file. |

**Verdict: missing derivation.** The hook exists and is imported; the component simply never invokes it, so `currencySymbol` is never defined. The crash is a **ReferenceError** when any of the 10 references is evaluated.

---

## 5. Summary

| Item | Value |
|------|--------|
| **File** | `app/customers/[id]/statement/page.tsx` |
| **References** | Lines 109, 258, 262, 267, 272, 276, 304, 306, 319, 333 |
| **Expected source** | `useBusinessCurrency()` → `currencySymbol` from business `default_currency` |
| **Root cause** | **Missing derivation**: hook imported (line 6) but never called; no other definition of `currencySymbol`. |
