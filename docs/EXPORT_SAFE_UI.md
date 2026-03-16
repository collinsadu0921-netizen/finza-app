# Export-Safe UI (Print / Preview / PDF)

Preview, export, and print views must show **only document data** — no UI controls.

## Detection

- **Route:** `/preview/*`, `/export/*`, `/print/*`, `/pdf/*`
- **Query:** `?print=true`, `?export=true`, `?pdf=true`
- **CSS:** `@media print` (when user prints, e.g. Ctrl+P)

See `lib/exportMode.ts` and `lib/hooks/useExportMode.ts`.

## Hiding UI

Use these classes so elements are hidden in export/print:

| Class         | When hidden |
|---------------|-------------|
| `.export-hide`| When `[data-export-mode="true"]` is set (query/route) **or** when printing |
| `.print-hide` | When printing (`@media print`) only |
| `.no-print`   | Alias for print; same as `.print-hide` |

**Guardrail:** UI controls (buttons, toolbars, filters, sidebars, nav, modals) **MUST** include `.export-hide` (or `.print-hide`) so they do not appear in:

- Print preview
- PDF exports
- Document preview pages
- Invoice / bill / report previews

## Layout

`ProtectedLayout` sets `data-export-mode="true"` when `useExportMode()` is true and adds `.export-hide.print-hide` to:

- Sidebar wrapper
- Top navigation bar
- Accounting breadcrumbs and client warning

Global CSS in `app/globals.css` hides `.export-hide` and `.print-hide` under `@media print` and under `[data-export-mode="true"]`.

## PDF rendering

PDF API routes (e.g. `/api/invoices/[id]/pdf-preview`) generate HTML or PDF server-side and do **not** use the app layout; they use the shared document template only. No change required there.

## Components

- **ExportSafeView** (`components/ExportSafeView.tsx`): Optional wrapper to render only children when in export mode (e.g. omit chrome).
- **useExportMode** (`lib/hooks/useExportMode.ts`): Returns `true` when the page is in export/preview/print mode (route or query).
