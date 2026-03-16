# Phase 12 — Service Workspace Copy Replacement (Permission/RLS/Policy)

**Scope:** Service workspace only.  
**Constraint:** User-facing text only; no auth, RLS, storage policy, or API logic changes.

---

## Files changed + line ranges

| File | Line range | Change type |
|------|------------|-------------|
| `app/settings/business-profile/page.tsx` | 141–152, 167–169, 179–181 | Replaced logo-upload and save-error copy |
| `app/invoices/[id]/view/page.tsx` | 136 | Replaced view-invoice error copy |
| `app/invoices/new/page.tsx` | 578–579, 714–715 | Replaced create-invoice error copy (2 places) |
| `app/portal/accounting/page.tsx` | 151, 208, 249, 278, 307, 341 | Replaced role-check error copy (6 places) |
| `app/products/[id]/edit/page.tsx` | 261–263, 294–296, 359–362 | Replaced upload/process image error copy (3 places) |
| `app/products/new/page.tsx` | 137, 181–182, 208–210 | Replaced upload/process image error copy (3 places) |

---

## Before / after (exact user-facing strings)

### 1. app/settings/business-profile/page.tsx

| Before | After |
|--------|--------|
| `Storage bucket 'business-assets' not found. Please ensure the bucket exists and is public in Supabase Dashboard > Storage.` | *(removed branch; folded into generic message)* |
| `Permission denied. Please check storage policies for 'business-assets' bucket in Supabase Dashboard.` | *(removed branch; folded into generic message)* |
| `` `Failed to upload logo: ${uploadError.message}` `` | `Unable to upload logo right now. Please try again. If it continues, contact support.` |
| `` `Failed to save logo URL: ${updateError.message}` `` | `Logo uploaded but could not be saved. Please try again. If it continues, contact support.` |
| `err.message \|\| "Failed to upload logo"` (catch) | `Unable to upload logo right now. Please try again. If it continues, contact support.` |

*(Bucket-not-found and permission/policy branches were removed; both cases now use the same generic message as the else branch.)*

---

### 2. app/invoices/[id]/view/page.tsx

| Before | After |
|--------|--------|
| `You don't have permission to view this invoice.` | `You can't view this invoice. It may have been removed or you don't have access.` |

---

### 3. app/invoices/new/page.tsx

| Before | After |
|--------|--------|
| `You don't have permission to create invoices.` (2 occurrences) | `You can't create invoices with your current access. Contact your business owner or admin if you need access.` |

---

### 4. app/portal/accounting/page.tsx

| Before | After |
|--------|--------|
| `You don't have permission (admin/owner/accountant only).` (6 occurrences) | `This area is only available to business owners and authorized staff.` |

---

### 5. app/products/[id]/edit/page.tsx

| Before | After |
|--------|--------|
| `` `Failed to upload image: ${uploadError.message}` `` (uploadProductImage) | `Unable to upload image right now. Please try again. If it continues, contact support.` |
| `err.message \|\| "Failed to process image"` (handleImageChange catch) | `Unable to process image. Please try again.` |
| `` `Failed to upload image: ${m}` `` (handleSubmit catch) | `Unable to upload image right now. Please try again. If it continues, contact support.` |

---

### 6. app/products/new/page.tsx

| Before | After |
|--------|--------|
| `` `Product created but image upload failed: ${imgErr.message}` `` | `Product created but image could not be uploaded. You can add an image later by editing the product.` |
| `` `Failed to upload image: ${uploadError.message}` `` (uploadProductImage) | `Unable to upload image right now. Please try again. If it continues, contact support.` |
| `err.message \|\| "Failed to process image"` (handleImageChange catch) | `Unable to process image. Please try again.` |

---

## Grep evidence: no banned terms in Service user-facing copy

Banned terms: `Permission denied`, `permission denied` (as message), `RLS`, `policy`/`policies` (as message), `disable RLS`, `storage` (in error text), `bucket` (in error text), `Supabase Dashboard`, `check your policies`, `row-level security`, `You don't have permission`, `don't have permission (admin` (portal).

**1. setError / throw new Error containing banned phrases (Service routes only):**

Searched in: `app/settings`, `app/invoices`, `app/portal`, `app/products` (excluding `app/accounting`, `app/firm`, `app/admin`).

- No `setError(...Permission denied...)` in Service routes.
- No `setError(...RLS...)` in Service routes.
- No `setError(...storage policies...)` in Service routes.
- No `setError(...bucket...)` in Service routes.
- No `setError(...Supabase Dashboard...)` in Service routes.
- No `throw new Error(...permission...)` in Service routes (invoice view and invoice new now use neutral copy).
- No `You don't have permission` or `don't have permission (admin` in Service routes (portal and invoices updated).

**2. Remaining mentions of banned terms in app (expected, out-of-scope or non–user-facing):**

- **Comments/code only (not user-facing):**  
  `app/settings/business-profile/page.tsx` — comments "Upload to Supabase Storage", "bucket should exist"; and `supabase.storage` usage. No user-facing text.
- **Retail / Accounting (out of scope):**  
  `app/(dashboard)/pos/page.tsx` — "You don't have permission to create this sale" (Retail).  
  `app/accounting/*`, `app/admin/*`, `app/firm/*` — not Service workspace; unchanged per scope.

**3. Confirmation:**

- All replaced strings were the only user-facing occurrences of the banned phrases in the in-scope Service routes (settings, invoices, portal, products).
- No auth, RLS, storage policy, or API behavior was changed; only copy was updated.

---

## Summary

- **6 files** updated, **~20 user-facing strings** replaced with premium, neutral copy.
- **Tone:** Action-oriented, no technical/permission/RLS/storage/bucket/Supabase language; suggests “try again” or “contact support” where appropriate.
- **Service workspace:** No remaining user-facing “permission denied”, “RLS”, “policy”, “storage policy”, “bucket”, “Supabase Dashboard”, or “check your policies” copy in the in-scope routes.  
- **Out of scope:** Retail (e.g. POS, sales-history, admin/retail, inventory) and Accounting/Firm routes were not modified.
