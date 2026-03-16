# RETAIL ONBOARDING IMPLEMENTATION PLAN

## Overview
This plan outlines the complete implementation of a retail-specific onboarding workflow for Finza. This onboarding applies **ONLY** when `business.industry === "retail"`. Service, Professional, and Logistics modes remain unchanged.

---

## CURRENT STATE ANALYSIS

### Existing Infrastructure
- **Onboarding System**: Uses `businesses.onboarding_step` (TEXT) column to track progress
- **Business Profile**: Already exists at `/settings/business-profile` with comprehensive fields
- **Store Creation**: Exists at `/admin/retail/stores` - creates stores directly in `stores` table
- **Product Creation**: Exists at `/products` - full-featured product management
- **Register Sessions**: Exists at `/sales/open-session` - opens `cashier_sessions` table
- **POS Terminal**: Exists at `/pos` - requires active store and register session

### Database Schema (Existing)
- **`businesses` table**: Contains `onboarding_step` (TEXT, default: 'business_profile')
- **`stores` table**: `id`, `business_id`, `name`, `location`, `phone`, `email`, `opening_hours`, `created_at`, `updated_at`
- **`registers` table**: `id`, `business_id`, `name`, `store_id`, `created_at`
- **`cashier_sessions` table**: `id`, `register_id`, `user_id`, `business_id`, `store_id`, `opening_float`, `status`, `started_at`, `ended_at`
- **`products` table**: Full product schema with variants, modifiers, etc.
- **`products_stock` table**: Per-store inventory tracking (`product_id`, `store_id`, `stock`, `stock_quantity`)

### Current Onboarding Flow (Generic)
- Step 1: Business Profile
- Step 2: Add Customer (service/professional)
- Step 3: Add Product/Service
- Step 4: Create Invoice (service/professional)

---

## NEW RETAIL ONBOARDING STEPS

### Step 1: Business Profile
**Status**: ✅ Already exists, needs integration

**Fields Available**:
- `legal_name` (TEXT)
- `trading_name` (TEXT)
- `address_street`, `address_city`, `address_region`, `address_country` (TEXT)
- `phone`, `whatsapp_phone` (TEXT)
- `email`, `website` (TEXT)
- `tin` (TEXT - Tax Identification Number)
- `logo_url` (TEXT)
- `default_currency` (TEXT, default: 'GHS')
- `start_date` (DATE)

**Navigation Logic**:
- User completes business profile at `/settings/business-profile`
- On save, check if `business.industry === "retail"`
- If retail, update `onboarding_step = "create_store"`
- Redirect to `/onboarding/retail/store`

**Validation Requirements**:
- Minimum: `trading_name` OR `legal_name` (at least one)
- Recommended: `phone`, `email`, `address_street`
- Optional: Logo, TIN, website

**Completion Detection**:
- Check if `business.legal_name` OR `business.trading_name` exists
- If yes, allow progression to Step 2

---

### Step 2: Create Store (NEW)
**Status**: 🆕 New onboarding screen required

**Purpose**: Create the first store before products/registers can be used

**Required Fields**:
- `name` (TEXT, REQUIRED) - Store name
- `location` (TEXT, OPTIONAL) - Physical address
- `phone` (TEXT, OPTIONAL) - Store phone
- `email` (TEXT, OPTIONAL) - Store email

**Optional Fields** (for future):
- `opening_hours` (JSONB) - Store hours
- `default_tax_profile` (TEXT) - VAT settings (future enhancement)

**Database Table**: `stores`
- Uses existing `stores` table schema
- No schema changes needed

**API Endpoint**: 
- **Option A**: Reuse existing direct Supabase insert (current stores page does this)
- **Option B**: Create `POST /api/stores/create` for consistency
- **Recommendation**: Option B for better error handling and validation

**API Structure** (`POST /api/stores/create`):
```typescript
Request Body:
{
  name: string (required)
  location?: string
  phone?: string
  email?: string
}

Response:
{
  store: {
    id: string
    name: string
    location: string | null
    phone: string | null
    email: string | null
    created_at: string
  }
}
```

**Business Logic**:
1. Create store in `stores` table
2. Call `initializeStoreStock(businessId, storeId)` to create `products_stock` rows for all existing products
3. Set store as active: `setActiveStoreId(storeId, storeName)` (session storage)
4. Update `businesses.onboarding_step = "add_products"`
5. Redirect to `/onboarding/retail/products`

**UI Layout**: `/onboarding/retail/store.tsx`
- Simple form with 4 fields
- "Create Store" button
- "Skip for Now" button (allows progression but warns about POS requirements)
- Progress indicator showing Step 2 of 5

**Validation**:
- `name` is required (non-empty string)
- `phone` and `email` format validation (if provided)
- Business rule: At least one store must exist before POS can be used

---

### Step 3: Add Products
**Status**: 🔄 Modify existing product creation for onboarding context

**Purpose**: Add initial products to inventory

**Fields**:
- `name` (TEXT, REQUIRED)
- `price` (NUMERIC, REQUIRED)
- `category_id` (UUID, OPTIONAL) - Link to category
- `barcode` (TEXT, OPTIONAL) - SKU/Barcode
- `stock` (INTEGER, OPTIONAL) - Initial stock quantity
- `unit` (TEXT, OPTIONAL) - Unit of measurement
- `track_stock` (BOOLEAN, default: true)

**Approach**: 
- **Option A**: Reuse existing `/products` page with onboarding context
- **Option B**: Create lightweight onboarding-specific form at `/onboarding/retail/products`
- **Recommendation**: Option B for better UX (simpler, focused on essentials)

**UI Design** (`/onboarding/retail/products.tsx`):
- Simplified product form (name, price, category, barcode, initial stock)
- "Add Another Product" button (allows multiple products quickly)
- Product list showing added products
- "Continue" button (proceeds to Step 4)
- "Skip for Now" button (allows CSV import later)

**API**: 
- Reuse existing `POST /api/products/create` endpoint
- Ensure `products_stock` rows are created for active store automatically

**Business Logic**:
1. User adds products (one or multiple)
2. Each product creates:
   - Row in `products` table
   - Row in `products_stock` table for active store (with initial stock)
3. On "Continue": Update `businesses.onboarding_step = "open_register"`
4. Redirect to `/onboarding/retail/register`

**CSV Import Skip**:
- If user clicks "Skip", allow progression
- Show message: "You can import products later via CSV at Products page"
- Still proceed to Step 4

**Multiple Products Flow**:
- Form allows adding multiple products without page reload
- Show list of added products
- "Add Another" button resets form but keeps list
- "Continue" proceeds to next step

---

### Step 4: Open Register Session
**Status**: 🔄 Modify existing register session flow for onboarding

**Purpose**: Open first cashier session before POS can be used

**Required Fields**:
- `register_id` (UUID, REQUIRED) - Must select or create a register
- `opening_float` (NUMERIC, REQUIRED) - Starting cash amount (default: 0)
- `store_id` (UUID, AUTO) - Uses active store from Step 2

**Database Tables**:
- `registers` table - Must have at least one register
- `cashier_sessions` table - Creates new session

**Business Rules**:
1. **Register Creation**: If no registers exist, auto-create one:
   - Name: "Main Register" or "Register 1"
   - Assign to active store (`store_id`)
   - Create register via direct insert or API
2. **Session Creation**: Create session in `cashier_sessions` table
3. **Store Requirement**: Session must belong to active store
4. **No Sales Rule**: POS cannot create sales without open session

**API Endpoint**: 
- Reuse existing logic from `/sales/open-session` page
- Or create `POST /api/registers/open-session` for consistency

**API Structure** (`POST /api/registers/open-session`):
```typescript
Request Body:
{
  register_id: string (required)
  opening_float: number (required, >= 0)
  store_id?: string (optional, uses active store if not provided)
}

Response:
{
  session: {
    id: string
    register_id: string
    user_id: string
    business_id: string
    store_id: string
    opening_float: number
    status: "open"
    started_at: string
  }
}
```

**UI Layout** (`/onboarding/retail/register.tsx`):
- Register selector dropdown (shows existing registers for active store)
- If no registers: Show "Create Register" button (auto-creates "Main Register")
- Opening Float input (default: 0, allows decimal)
- "Open Session" button
- "Skip for Now" button (warns that POS requires session)

**Business Logic**:
1. Check if registers exist for active store
2. If none, auto-create "Main Register" assigned to store
3. User selects register and enters opening float
4. Create `cashier_sessions` row with:
   - `register_id`
   - `user_id` (current user)
   - `business_id`
   - `store_id` (active store)
   - `opening_float`
   - `status = "open"`
   - `started_at = NOW()`
5. Update `businesses.onboarding_step = "start_pos"`
6. Redirect to `/onboarding/retail/completed` or directly to `/pos`

**Validation**:
- Register must belong to active store
- Opening float must be >= 0
- User cannot have multiple open sessions for same store

---

### Step 5: Start POS
**Status**: ✅ POS exists, needs onboarding completion tracking

**Purpose**: Complete onboarding and redirect to POS

**Actions**:
1. Verify prerequisites:
   - ✅ Business profile completed
   - ✅ Store created and active
   - ✅ Register session open
   - ✅ User has permissions
2. Update `businesses.onboarding_step = "complete"`
3. Optionally: Set `businesses.onboarding_completed_at = NOW()` (if column exists)
4. Redirect to `/pos`

**POS Detection**:
- POS already checks for active store (shows error if missing)
- POS already checks for register session (shows error if missing)
- No changes needed to POS logic

**Completion Tracking**:
- **Option A**: Use `onboarding_step = "complete"` (current system)
- **Option B**: Add `onboarding_completed_at` timestamp column
- **Recommendation**: Option A (simpler, reuses existing column)

**UI** (`/onboarding/retail/completed.tsx`):
- Success message: "You're all set! Starting POS..."
- Loading spinner
- Auto-redirect to `/pos` after 2 seconds
- Manual "Go to POS" button

---

## NAVIGATION + LOGIC

### Route Protection
**Middleware/Guard Logic**:

1. **Onboarding Detection**:
   ```typescript
   function needsRetailOnboarding(business: Business): boolean {
     if (business.industry !== "retail") return false
     if (business.onboarding_step === "complete") return false
     return true
   }
   ```

2. **Route Guards**:
   - `/pos` - Check: active store exists AND register session open
   - `/sales/open-session` - Check: active store exists
   - `/products` - No guard (can add products anytime)
   - `/admin/retail/stores` - No guard (can manage stores anytime)

3. **Redirect Logic**:
   - If `business.industry === "retail"` AND `onboarding_step !== "complete"`:
     - Redirect to `/onboarding/retail/[step]` based on `onboarding_step`
   - If `onboarding_step === "complete"`:
     - Allow normal navigation

### Onboarding Progress Storage
**Location**: `businesses.onboarding_step` (TEXT column)

**Valid Values for Retail**:
- `"business_profile"` - Step 1
- `"create_store"` - Step 2
- `"add_products"` - Step 3
- `"open_register"` - Step 4
- `"start_pos"` - Step 5
- `"complete"` - Finished

**Update Points**:
- After Business Profile save → `"create_store"`
- After Store creation → `"add_products"`
- After Products added → `"open_register"`
- After Register session opened → `"start_pos"`
- After POS accessed → `"complete"`

### Auto-Detection Logic
**In `/dashboard/page.tsx`**:
```typescript
if (business.industry === "retail" && business.onboarding_step !== "complete") {
  // Redirect to appropriate onboarding step
  const stepRoute = getOnboardingRoute(business.onboarding_step)
  router.push(stepRoute)
}
```

**Helper Function**:
```typescript
function getOnboardingRoute(step: string): string {
  const routes: Record<string, string> = {
    "business_profile": "/onboarding/retail/profile",
    "create_store": "/onboarding/retail/store",
    "add_products": "/onboarding/retail/products",
    "open_register": "/onboarding/retail/register",
    "start_pos": "/onboarding/retail/completed"
  }
  return routes[step] || "/onboarding/retail/store"
}
```

---

## UI STRUCTURE

### File Structure
```
app/
  onboarding/
    retail/
      page.tsx              # Main retail onboarding router/container
      profile.tsx           # Step 1: Business Profile (redirects to /settings/business-profile)
      store.tsx             # Step 2: Create Store (NEW)
      products.tsx          # Step 3: Add Products (NEW, simplified)
      register.tsx           # Step 4: Open Register Session (NEW, simplified)
      completed.tsx          # Step 5: Completion screen + redirect to POS
```

### Component Structure

#### `/onboarding/retail/page.tsx` (Router)
- Loads business data
- Checks `business.industry === "retail"`
- Reads `business.onboarding_step`
- Renders appropriate step component based on step
- Shows progress indicator (Step X of 5)

#### `/onboarding/retail/profile.tsx`
- Wrapper around `/settings/business-profile`
- On save completion, updates `onboarding_step = "create_store"`
- Redirects to `/onboarding/retail/store`

#### `/onboarding/retail/store.tsx` (NEW)
- Form: name, location, phone, email
- Calls `POST /api/stores/create`
- On success: Sets active store, updates step, redirects to products

#### `/onboarding/retail/products.tsx` (NEW)
- Simplified product form
- "Add Another" functionality
- Product list display
- Calls `POST /api/products/create` for each product
- On "Continue": Updates step, redirects to register

#### `/onboarding/retail/register.tsx` (NEW)
- Auto-creates register if none exists
- Register selector dropdown
- Opening float input
- Calls `POST /api/registers/open-session`
- On success: Updates step, redirects to completed

#### `/onboarding/retail/completed.tsx`
- Success message
- Auto-redirect to `/pos` after 2 seconds
- Manual "Go to POS" button

### Shared Components
- **ProgressIndicator**: Shows "Step X of 5" with visual progress bar
- **OnboardingLayout**: Wrapper with consistent styling, skip button
- **StepNavigation**: Previous/Next buttons (where applicable)

---

## API STRUCTURE

### New Endpoints

#### `POST /api/stores/create`
**Purpose**: Create store during onboarding
**Auth**: Required (authenticated user)
**Body**:
```json
{
  "name": "Main Store",
  "location": "Accra, Osu",
  "phone": "0551234567",
  "email": "store@example.com"
}
```
**Response**:
```json
{
  "store": {
    "id": "uuid",
    "name": "Main Store",
    "location": "Accra, Osu",
    "phone": "0551234567",
    "email": "store@example.com",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```
**Business Logic**:
1. Validate `name` is required
2. Insert into `stores` table
3. Call `initializeStoreStock(businessId, storeId)` to create stock rows
4. Return created store

#### `POST /api/registers/open-session` (Optional - may reuse existing)
**Purpose**: Open register session during onboarding
**Auth**: Required
**Body**:
```json
{
  "register_id": "uuid",
  "opening_float": 1000.00,
  "store_id": "uuid" // optional, uses active store if not provided
}
```
**Response**:
```json
{
  "session": {
    "id": "uuid",
    "register_id": "uuid",
    "user_id": "uuid",
    "business_id": "uuid",
    "store_id": "uuid",
    "opening_float": 1000.00,
    "status": "open",
    "started_at": "2024-01-01T00:00:00Z"
  }
}
```
**Business Logic**:
1. Validate register belongs to store
2. Check no existing open session for user/store
3. Insert into `cashier_sessions` table
4. Return created session

### Modified Endpoints

#### `PATCH /api/business/profile` (Existing)
**Modification**: After save, if `industry === "retail"` and step is `"business_profile"`, update `onboarding_step = "create_store"`

#### `POST /api/products/create` (Existing)
**Modification**: Ensure `products_stock` rows are created for active store automatically (may already do this)

---

## IMPLEMENTATION ORDER

### Phase 1: Foundation (Week 1)
1. **Update Onboarding Router**
   - Modify `/onboarding/page.tsx` to detect retail industry
   - Route retail users to `/onboarding/retail/*` paths
   - Keep existing service/professional/logistics flows unchanged

2. **Create Retail Onboarding Container**
   - Create `/onboarding/retail/page.tsx`
   - Implement step routing based on `business.onboarding_step`
   - Add progress indicator component

3. **Update Business Profile Integration**
   - Modify `/settings/business-profile` to update `onboarding_step` on save
   - Create `/onboarding/retail/profile.tsx` wrapper
   - Test progression from Step 1 to Step 2

### Phase 2: Store Creation (Week 1-2)
4. **Create Store API Endpoint**
   - Implement `POST /api/stores/create`
   - Add validation and error handling
   - Integrate `initializeStoreStock` call

5. **Create Store Onboarding Screen**
   - Build `/onboarding/retail/store.tsx`
   - Implement form with validation
   - Add "Skip" functionality (with warning)
   - Test store creation and step progression

6. **Store Session Integration**
   - Ensure `setActiveStoreId()` is called after store creation
   - Test store switcher shows new store

### Phase 3: Products (Week 2)
7. **Create Products Onboarding Screen**
   - Build `/onboarding/retail/products.tsx`
   - Simplified form (name, price, category, barcode, stock)
   - "Add Another" functionality
   - Product list display
   - Test product creation and stock initialization

8. **Product API Integration**
   - Verify `POST /api/products/create` creates `products_stock` rows
   - Test multiple products can be added
   - Test "Skip" functionality

### Phase 4: Register Session (Week 2-3)
9. **Create Register Auto-Creation Logic**
   - Implement auto-create "Main Register" if none exists
   - Assign register to active store
   - Test register creation flow

10. **Create Register Session Onboarding Screen**
    - Build `/onboarding/retail/register.tsx`
    - Register selector (or auto-select if only one)
    - Opening float input
    - Test session creation

11. **Register Session API** (if new endpoint needed)
    - Implement `POST /api/registers/open-session` OR
    - Reuse existing logic from `/sales/open-session`
    - Test session creation and validation

### Phase 5: Completion & Guards (Week 3)
12. **Create Completion Screen**
    - Build `/onboarding/retail/completed.tsx`
    - Success message and auto-redirect
    - Update `onboarding_step = "complete"`
    - Test redirect to POS

13. **Implement Route Guards**
    - Add guard to `/pos` (check store + session)
    - Add guard to `/sales/open-session` (check store)
    - Add auto-redirect logic in `/dashboard/page.tsx`
    - Test guards prevent access without prerequisites

14. **Onboarding Skip Functionality**
    - Add "Skip All" button to each step
    - Set `onboarding_step = "complete"` on skip
    - Show warning about POS requirements
    - Test skip flow

### Phase 6: Testing & Polish (Week 3-4)
15. **End-to-End Testing**
    - Test complete flow: Profile → Store → Products → Register → POS
    - Test skip at each step
    - Test error handling (missing store, missing register, etc.)
    - Test with existing stores/products/registers

16. **UI/UX Polish**
    - Add loading states
    - Add error messages
    - Add success confirmations
    - Ensure consistent styling

17. **Documentation**
    - Update user documentation
    - Add inline help text
    - Create troubleshooting guide

---

## SCHEMA NOTES

### No Schema Changes Required
- All required tables exist: `businesses`, `stores`, `registers`, `cashier_sessions`, `products`, `products_stock`
- `businesses.onboarding_step` column already exists
- No new columns needed

### Optional Enhancements (Future)
- `businesses.onboarding_completed_at` (TIMESTAMP) - Track completion date
- `stores.default_tax_profile` (TEXT) - Store-specific tax settings
- `registers.default_opening_float` (NUMERIC) - Default float amount

---

## LOGIC OVERVIEW

### Onboarding State Machine
```
business_profile → create_store → add_products → open_register → start_pos → complete
     ↓                ↓              ↓              ↓              ↓
   Skip            Skip           Skip          Skip          Skip
     ↓                ↓              ↓              ↓              ↓
  complete         complete       complete       complete      complete
```

### Prerequisites Chain
- **Step 2 (Store)**: Requires Step 1 (Business Profile)
- **Step 3 (Products)**: Requires Step 2 (Store) - needs active store for stock
- **Step 4 (Register)**: Requires Step 2 (Store) - register must belong to store
- **Step 5 (POS)**: Requires Step 2 (Store) + Step 4 (Register Session)

### Skip Logic
- User can skip any step except Step 1 (Business Profile)
- Skipping sets `onboarding_step = "complete"`
- POS will show errors if prerequisites missing (store, session)
- User can complete skipped steps later via normal pages

---

## EDGE CASES & ERROR HANDLING

### Edge Cases
1. **User has existing stores**: Skip Step 2, auto-select first store
2. **User has existing products**: Skip Step 3, proceed to Step 4
3. **User has existing register session**: Skip Step 4, proceed to Step 5
4. **Multiple stores exist**: Use first store or let user select
5. **No registers exist**: Auto-create "Main Register" in Step 4
6. **User closes browser mid-onboarding**: Resume at last step on return

### Error Handling
- **API failures**: Show user-friendly error messages
- **Validation errors**: Highlight invalid fields
- **Network errors**: Retry mechanism or manual retry button
- **Permission errors**: Redirect to login or show access denied

---

## TESTING CHECKLIST

### Unit Tests
- [ ] Store creation API endpoint
- [ ] Register session API endpoint
- [ ] Onboarding step progression logic
- [ ] Route guard logic

### Integration Tests
- [ ] Complete onboarding flow (all steps)
- [ ] Skip functionality at each step
- [ ] Store activation after creation
- [ ] Product stock initialization
- [ ] Register session creation

### E2E Tests
- [ ] New retail business completes onboarding
- [ ] Existing retail business resumes onboarding
- [ ] POS access after onboarding completion
- [ ] POS access blocked without prerequisites

---

## ROLLOUT PLAN

### Phase 1: Internal Testing
- Deploy to staging environment
- Test with test business accounts
- Fix critical bugs

### Phase 2: Beta Testing
- Enable for select retail businesses
- Gather feedback
- Iterate on UX

### Phase 3: Full Rollout
- Enable for all new retail businesses
- Existing retail businesses: Show onboarding prompt (optional)
- Monitor error rates and completion rates

---

## SUCCESS METRICS

- **Onboarding Completion Rate**: % of retail businesses completing all 5 steps
- **Time to First Sale**: Time from signup to first POS transaction
- **Drop-off Points**: Which step has highest abandonment rate
- **Error Rate**: % of users encountering errors during onboarding

---

## FUTURE ENHANCEMENTS

1. **Store Templates**: Pre-configured store setups for common retail types
2. **Product Import**: CSV import during onboarding Step 3
3. **Register Templates**: Pre-configured register setups
4. **Onboarding Analytics**: Track completion rates and bottlenecks
5. **Progressive Disclosure**: Show advanced options only when needed
6. **Mobile Onboarding**: Optimized mobile flow for tablet-based POS setups

---

## NOTES

- **Backward Compatibility**: Existing retail businesses with `onboarding_step = "complete"` are unaffected
- **Multi-Store**: Onboarding creates first store; additional stores can be added later
- **Permissions**: Onboarding assumes user is owner/admin; store managers/cashiers skip to POS
- **Internationalization**: All text should be i18n-ready (future enhancement)

---

**END OF PLAN**



















