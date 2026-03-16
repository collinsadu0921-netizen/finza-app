# Domain Creation Boundary Guard — Phase 0 Semantic Freeze

**Purpose:** Make it **impossible** for "Create Service" intent to create a product-shaped, inventory-capable record.  
**Phase:** 0 — Semantic Freeze. No migration, no model unification, no inventory logic changes.  
**Constraints:** No new tables, no table renames, no schema migration, no UI-only enforcement.

---

## 1. Service Creation Intent Signals

### 1.1 How the System Currently Expresses "Create Service" Intent

| Source | Signal | Location | Reaches backend? |
|--------|--------|----------|------------------|
| **Products page** | Button label "Create Service" when `business.industry === "service"` | `app/products/page.tsx` 589, 642 | **No.** Click → `router.push("/products/new")`. No query param, no header, no API. |
| **Navigation** | Same URL for both intents | `/products/new` | **No.** Page is unaware of service vs product. |
| **Products new page** | None | `app/products/new/page.tsx` | **No.** No industry check, no `create_as` or workspace. Always creates in `products` + `products_stock`. |
| **Sync-to-services** | Route + `business.industry === "service"` | `POST /api/products/sync-to-services` | **Yes.** Intent implicit (API purpose). Writes **products_services** only. |
| **Invoice new fallback** | Context (invoice create, `products_services` empty/failed) | `app/invoices/new/page.tsx` 196–251 | **Partially.** Uses sync API or client Supabase → **products_services**. No product creation. |

### 1.2 Create Paths and Target Table

| Flow | Entry | Write path | Target table |
|------|--------|------------|--------------|
| **Create Service** (products) | "Create Service" / "Create Your First Service" on `/products` | Navigate to `/products/new` → client Supabase | **`products`** (+ `products_stock`) |
| **Create Product** (products) | "Create Product" on `/products` | Same | **`products`** (+ `products_stock`) |
| **Sync-to-services** | Invoice new when services empty, or explicit sync | `POST /api/products/sync-to-services` or client loop | **`products_services`** only |
| **Invoice fallback** (on `products_services` error) | Load fail | Client Supabase insert loop | **`products_services`** only |

### 1.3 Ambiguous or Unsafe Flows

| Flow | Issue |
|------|--------|
| **Create Service → /products/new** | Intent is **UI-only**. Lost on navigation. Same handler as Create Product. **Always** writes to `products`. **Unsafe.** |
| **/products/new** | **Ambiguous.** Used for both intents. No backend, no intent signal. **Single** code path → `products`. |
| **Invoice fallback "use products as dropdown"** | Does **not** create new catalog rows. Uses existing `products` as line items. No creation-boundary violation. |
| **Invoice fallback "sync"** | Creates in **products_services** only (API or client loop). **Safe** for creation boundary. |

### 1.4 Summary

- **Intent:** "Create Service" is today expressed **only** by UI (button label). It is **not** passed to any backend.
- **Unsafe path:** "Create Service" → `/products/new` → client Supabase → **`products`**. This is the **only** flow that creates product-shaped records from Create Service intent.
- **Safe paths:** Sync-to-services (API), invoice fallback sync (API or client → `products_services`). Neither writes to `products` for creation.

---

## 2. Creation Boundary Guard Design

### 2.1 Rule

**If intent = service AND target table = products → REJECT.**

- Service creation **MUST** write to `products_services` only.
- Any attempt to create a service by writing to `products` **MUST** be rejected before the write.

### 2.2 Where the Guard Lives

| Layer | Role | Mandatory? |
|-------|------|------------|
| **Service creation API** | Single backend entry point for "Create Service". Receives explicit intent. Writes **only** to `products_services`. Rejects if it would write to `products`. | **Yes.** |
| **Callers** | "Create Service" UI **MUST** use this API only. **MUST NOT** use `/products/new` or any flow that writes to `products`. | **Yes.** |

The guard is **backend-only**. It lives in the **service creation API handler**. The **same** guarantee holds "even if UI changes" and "even if developers reuse code" only if Create Service **never** uses a path that hits `products`. That requires **removing** the Create Service → `/products/new` path and **routing** Create Service through the API.

### 2.3 Service Creation API (Design)

- **Route:** e.g. `POST /api/products/create-service` (or equivalent under existing products API surface). Exact path is implementation detail.
- **Request:** Body includes at least `business_id`, `name`, `unit_price`, and **explicit intent** (e.g. `create_as: "service"` or equivalent). Intent **MUST** be in the request, not inferred only from route.
- **Behaviour:** Inserts **only** into `products_services` with `type = 'service'`. **Never** inserts into `products` or `products_stock`.
- **Guard:** Before any DB write, assert "target table is `products_services`". If the handler would ever write to `products`, **reject** instead of writing.

### 2.4 How Intent Is Detected

- **Explicit in request:** e.g. `create_as: "service"` in JSON body, or `X-Create-Intent: service` header. No reliance on workspace, route, or referrer alone for the guard.
- **Implicit in route (defense-in-depth):** The service-create API is **only** used for service creation. Callers must send explicit intent as well; the guard checks it.

### 2.5 How Target Table Is Detected

- The **handler** chooses the table. It **only** implements insert into `products_services`. "Target" is thus fixed.
- **Guard check:** If `create_as === "service"` and the code path would perform an insert into `products`, **abort** and return error **before** executing the insert.

### 2.6 Rejection

- **HTTP status:** **400** (or **422**).
- **Body:** Domain-level error code and message, e.g.  
  `{ "error": "SERVICE_CREATION_BOUNDARY_VIOLATION", "message": "Create Service must write to products_services only. Writing to products is not allowed." }`
- **Behaviour:** **Fail loudly.** No silent fallback, no retry into `products`.

### 2.7 Run Before Any DB Write

- The guard runs **inside** the service-create API handler, **before** any `insert` (or `upsert`) to `products` or `products_stock`.
- If the handler is structured so it **never** writes to `products`, the guard is a **defensive check**: either (a) an explicit `if (intent === 'service' && target === 'products') reject`, or (b) a shared "create item" helper used by both product and service handlers, which rejects when `intent === 'service'` and `target === 'products'`.

### 2.8 Impossible to Bypass via UI Reuse

- **Create Service** must **not** use `/products/new` or any product-creation flow. It must use a **dedicated** flow (e.g. `/products/create-service` or `/products/new` with `?create_as=service` and **different** submit logic) that **only** calls the service-create API.
- **Product** creation may continue to use `/products/new` → client Supabase → `products` (or a product-create API). The guard does not rely on product creation changing; it ensures **service** creation **never** goes through that path.
- **Result:** Reusing the "Create Product" form or navigation for "Create Service" does **not** hit `products`, because Create Service no longer uses that path. The only way to create a service is through the API, which never writes to `products`.

### 2.9 Relation to Existing Sync

- `POST /api/products/sync-to-services` already writes only to `products_services`. It does **not** create services in `products`. It can remain as-is; no guard change required.
- The **new** guard applies to **single-item** "Create Service" flow. That flow **must** go through the new service-create API, not through `/products/new`.

---

## 3. Rejected Illegal States

With the Creation Boundary Guard in place, the following become **impossible**:

| # | Illegal State | How the Guard Prevents It |
|---|----------------|----------------------------|
| 1 | **Service created with stock capability** | Service creation writes only to `products_services`. No `products` or `products_stock` insert. |
| 2 | **Service created in `products`** | Guard rejects intent=service ∧ target=products. Create Service flow uses only the service-create API, which never writes to `products`. |
| 3 | **Service later appearing in POS or stock flows** | Services live only in `products_services`. POS/stock use `products` and `products_stock`. No new service rows in `products`. |
| 4 | **New service items polluting migration dataset** | New services are only in `products_services`. Migration can treat `products` as product-only. |
| 5 | **Developer reusing product creation for services** | Create Service does not use product-creation path. Reusing that path for "service" would require explicitly calling product create with service intent, which (if that path ever accepted intent) would be rejected by the guard. |
| 6 | **UI fallback silently creating product when services list empty** | "Create Your First Service" no longer routes to `/products/new`. It uses the service-create flow + API. Empty list does not trigger product creation. |

---

## 4. Phase 0 Acceptance Checklist

| Criterion | Answer |
|-----------|--------|
| Can any "Create Service" flow write to `products`? | **NO** |
| Can a developer accidentally reuse product creation logic for services? | **NO** |
| Can UI fallback silently create a product when services list is empty? | **NO** |
| Will all new services created from today forward be non-inventory? | **YES** |

### 4.1 Prerequisites for Sign-Off

- **Service creation API** exists, receives explicit `create_as: "service"`, writes only to `products_services`, and rejects before any write to `products`.
- **Create Service** UI (products page, empty state, etc.) **never** navigates to `/products/new` or reuses product-creation submit logic. It **only** uses the service-create API.
- **DB trigger** on `products_services` preventing `type` 'service' → 'product' remains (already assumed). It is **necessary but insufficient** without the creation-boundary guard.

---

## 5. Summary

| Aspect | Design |
|--------|--------|
| **Intent** | Explicit in request (`create_as: "service"` or equivalent). |
| **Guard rule** | intent = service ∧ target = products → **REJECT**. |
| **Guard location** | Service creation API handler, before any DB write. |
| **Target** | Service creation API writes only to `products_services`. |
| **Rejection** | 400/422, `SERVICE_CREATION_BOUNDARY_VIOLATION`, fail loudly. |
| **Bypass-proof** | Create Service never uses product-creation path; only the API. |

This design is **minimal**, **strict**, and **enforceable** as a temporary semantic firewall for Phase 0.
