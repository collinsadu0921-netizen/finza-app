# Finza Onboarding System - Current State Analysis

## Executive Summary

This document describes the current onboarding system exactly as it exists in the codebase. No modifications, fixes, or improvements are suggested - only factual documentation of how the system works today.

---

## 1. ENTRY CONDITION

### How the App Decides Whether a User Should Enter Onboarding

**Location:** Multiple entry points check for business existence:

#### Entry Point 1: `/business-setup` Page
**File:** `app/business-setup/page.tsx`

**Logic:**
- No explicit check for existing business in this component
- User can access this page directly
- If user submits the form, it creates a business and redirects to `/onboarding`

#### Entry Point 2: `/onboarding` Page
**File:** `app/onboarding/page.tsx` (lines 33-71)

**Logic in `loadBusiness()` function:**
1. Checks if user is authenticated via `supabase.auth.getUser()`
   - If no user → redirects to `/login`
2. Calls `getCurrentBusiness(supabase, user.id)` from `lib/business.ts`
   - If no business → redirects to `/business-setup`
3. If business exists:
   - Checks `businessData.industry === "retail"`
   - If retail → redirects to `/onboarding/retail`
   - If not retail → continues with generic onboarding
4. Loads `businessData.onboarding_step` from database
   - Defaults to `"business_profile"` if null/undefined
   - Sets `currentStep` state to this value

#### Entry Point 3: `/onboarding/retail` Page
**File:** `app/onboarding/retail/page.tsx` (lines 41-82)

**Logic in `loadBusiness()` function:**
1. Checks if user is authenticated
   - If no user → redirects to `/login`
2. Calls `getCurrentBusiness(supabase, user.id)`
   - If no business → redirects to `/business-setup`
3. Checks `businessData.industry !== "retail"`
   - If not retail → redirects to `/onboarding` (generic onboarding)
4. Loads `businessData.onboarding_step` from database
   - Defaults to `"business_profile"` if null/undefined
   - Maps generic step names to retail-specific steps via `mapToRetailStep()`
   - Sets `currentStep` state to mapped value

#### Entry Point 4: Auth Callback
**File:** `app/auth/callback/route.ts` (lines 47-60)

**Logic:**
1. After OAuth callback, checks if user has a business:
   ```typescript
   const { data: business } = await supabase
     .from("businesses")
     .select("id")
     .eq("owner_id", user.id)
     .maybeSingle()
   ```
2. If business exists → redirects to `/dashboard`
3. If no business → redirects to `/business-setup`

#### Entry Point 5: Dashboard Page
**File:** `app/dashboard/page.tsx` (lines 95-101)

**Logic in `loadBusinessAndRedirect()`:**
1. Calls `getCurrentBusiness(supabase, user.id)`
2. If no business → redirects to `/business-setup`

### Data Checked

**Tables Queried:**
- `businesses` table (via `getCurrentBusiness()`)
  - Checks `owner_id = userId` OR
  - Checks `business_users` table where `user_id = userId`
- `businesses.onboarding_step` column (TEXT, default: `'business_profile'`)

**Functions Used:**
- `getCurrentBusiness(supabase, userId)` from `lib/business.ts`
  - First checks `businesses.owner_id = userId`
  - Falls back to `business_users` join if not owner
  - Returns business object or `null`

**No Explicit Onboarding Flags:**
- There is NO separate "onboarding_completed" flag
- Onboarding state is inferred from `businesses.onboarding_step`:
  - If `onboarding_step === "complete"` → onboarding is done
  - If `onboarding_step !== "complete"` → user is in onboarding
  - If `onboarding_step` is null/undefined → defaults to `"business_profile"` (first step)

---

## 2. BUSINESS CREATION STEP

### Which File/Component Handles "Create Business" During Onboarding

**File:** `app/business-setup/page.tsx`

**Component:** `BusinessSetupPage`

**Function:** `handleSave()` (lines 55-109)

### After Successful Business Creation

**Code Execution Flow:**

1. **User Record Creation** (lines 69-75):
   - Calls `ensureUserRecord(currentUser)` to ensure user exists in `users` table
   - Creates user record if it doesn't exist

2. **Business Insertion** (lines 78-88):
   ```typescript
   const { data: business, error: businessError } = await supabase
     .from("businesses")
     .insert({
       owner_id: userRecord.id,
       name,
       industry,
       start_date: startDate || null,
       onboarding_step: "business_profile"  // ← Set to first step
     })
   ```
   - Creates business with `onboarding_step: "business_profile"`

3. **Business User Association** (lines 96-100):
   ```typescript
   await supabase.from("business_users").insert({
     business_id: business.id,
     user_id: userRecord.id,
     role: "admin"
   })
   ```
   - Creates `business_users` record with role "admin"

4. **Redirect** (line 108):
   ```typescript
   router.push("/onboarding")
   ```
   - **Explicit redirect** to `/onboarding` page
   - No state update for onboarding - relies on database value

### Onboarding-Related State Updates

**Database Updates:**
- `businesses.onboarding_step` is set to `"business_profile"` during business creation
- This is the ONLY onboarding state set during business creation

**No Client-Side State:**
- No sessionStorage/localStorage updates
- No React state updates for onboarding progress
- The `/onboarding` page will read `onboarding_step` from database on mount

---

## 3. PERSISTENCE

### Is Onboarding Progress Stored Anywhere?

**YES - Stored in Database:**

**Table:** `businesses`
**Column:** `onboarding_step` (TEXT)
**Default Value:** `'business_profile'` (set by migration `061_add_business_start_date_onboarding.sql`)

**Migration Files:**
- `supabase/migrations/061_add_business_start_date_onboarding.sql` (line 11):
  ```sql
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'business_profile';
  ```
- `supabase/migrations/067_ensure_start_date_column.sql` (lines 22-36):
  - Ensures column exists with default value

### How Progress is Updated

**File:** `app/onboarding/page.tsx` (lines 73-89)

**Function:** `updateOnboardingStep(step: OnboardingStep)`
```typescript
const { error } = await supabase
  .from("businesses")
  .update({ onboarding_step: step })
  .eq("id", businessId)
```

**File:** `app/onboarding/retail/page.tsx` (lines 98-114)

**Function:** `updateOnboardingStep(step: RetailOnboardingStep)`
```typescript
const { error } = await supabase
  .from("businesses")
  .update({ onboarding_step: step })
  .eq("id", businessId)
```

**When Progress is Updated:**
- When user clicks "Skip for Now" button → calls `handleStepComplete(nextStep)`
- When user completes a step → child component calls `onComplete()` callback
- When user clicks "Skip onboarding" → calls `skipOnboarding()` which sets step to `"complete"`

### Is Onboarding Inferred Indirectly?

**PARTIALLY:**

1. **Business Existence Check:**
   - If `getCurrentBusiness()` returns `null` → user is sent to `/business-setup`
   - This is an indirect check: "no business = needs onboarding"

2. **Onboarding Step Check:**
   - If `business.onboarding_step === "complete"` → onboarding is done
   - If `business.onboarding_step !== "complete"` → user is in onboarding
   - This is a DIRECT check using stored state

3. **No Explicit "Onboarding Required" Flag:**
   - There is NO `onboarding_required` boolean column
   - There is NO `onboarding_completed_at` timestamp
   - Onboarding state is ENTIRELY determined by `onboarding_step` value

---

## 4. RELOAD / NAVIGATION BEHAVIOR

### On Page Reload, How Does the App Decide Which Onboarding Step to Show?

**File:** `app/onboarding/page.tsx` (lines 29-71)

**On Component Mount:**
1. `useEffect(() => { loadBusiness() }, [])` runs once
2. `loadBusiness()` function executes:
   - Fetches business from database
   - Reads `businessData.onboarding_step` from database
   - Sets `currentStep` state: `setCurrentStep(step as OnboardingStep)`
   - Defaults to `"business_profile"` if `onboarding_step` is null/undefined

**File:** `app/onboarding/retail/page.tsx` (lines 30-82)

**On Component Mount:**
1. `useEffect(() => { loadBusiness() }, [])` runs once
2. `loadBusiness()` function executes:
   - Fetches business from database
   - Reads `businessData.onboarding_step` from database
   - Maps step via `mapToRetailStep()` function
   - Sets `currentStep` state to mapped value

**Key Behavior:**
- Onboarding step is ALWAYS read from database on page load
- No sessionStorage/localStorage is used to persist current step
- The step shown is whatever is stored in `businesses.onboarding_step`

### Why Does Onboarding Restart Instead of Resuming?

**Root Cause: Default Value Behavior**

When `onboarding_step` is:
- `null` → defaults to `"business_profile"` (line 63 in `app/onboarding/page.tsx`)
- `undefined` → defaults to `"business_profile"` (line 63)
- Empty string → treated as falsy, defaults to `"business_profile"`

**Code:**
```typescript
const step = businessData.onboarding_step || "business_profile"
```

**This means:**
- If `onboarding_step` is not explicitly set to a valid step name, it defaults to first step
- If database update fails silently, step remains at default
- If step value is invalid/unrecognized, it defaults to first step

### What Conditions Cause the User to Be Sent Back to the First Onboarding Page?

**Condition 1: `onboarding_step` is null/undefined**
- Database column is NULL
- Code defaults to `"business_profile"` (first step)

**Condition 2: `onboarding_step` is invalid/unrecognized**
- Step value doesn't match any valid step name
- Code defaults to `"business_profile"`

**Condition 3: Business doesn't exist**
- `getCurrentBusiness()` returns `null`
- User is redirected to `/business-setup` (which then redirects to `/onboarding`)

**Condition 4: Industry mismatch (retail onboarding)**
- User on `/onboarding/retail` but `business.industry !== "retail"`
- Redirects to `/onboarding` (generic onboarding, starts at first step)

**Condition 5: Database read failure**
- If `getCurrentBusiness()` throws error or returns null
- User is redirected to `/business-setup`

**Condition 6: Step mapping failure (retail onboarding)**
- In `mapToRetailStep()` (line 84-96 in `app/onboarding/retail/page.tsx`)
- If step doesn't match any key in `stepMap`, returns `"business_profile"` (first step)

---

## 5. WORKSPACE CONTEXT & COPY

### Why Does the Onboarding Header Show "Business Profile – Update your business information for professional invoices" Even When Onboarding a Retail Business?

**Location of the Copy:**
**File:** `app/settings/business-profile/page.tsx` (line 239)

**The Copy:**
```typescript
"Update your business information for professional invoices"
```

**Why This Happens:**

1. **Onboarding Redirects to Settings Page:**
   - Retail onboarding step "business_profile" (file: `app/onboarding/retail/profile.tsx`, line 29)
   - Calls `router.push("/settings/business-profile")`
   - User is taken to the generic business profile settings page

2. **Settings Page Has Hardcoded Copy:**
   - The `/settings/business-profile` page is NOT workspace-aware
   - It shows the same copy for ALL industries
   - The copy is hardcoded as "Update your business information for professional invoices"

3. **No Workspace/Industry Detection:**
   - The business profile page does NOT check `business.industry`
   - It does NOT conditionally render different copy based on workspace
   - It always shows the same professional/service-oriented copy

**Code Evidence:**
- `app/onboarding/retail/profile.tsx` (line 29): `router.push("/settings/business-profile")`
- `app/settings/business-profile/page.tsx` (line 239): Hardcoded string "Update your business information for professional invoices"
- No conditional logic based on `business.industry` in the business profile page

### Is the Same Component Reused Across Workspaces?

**YES - Business Profile Component is Shared:**

**File:** `app/settings/business-profile/page.tsx`

**Used By:**
- Generic onboarding (`/onboarding`) → Step "business_profile" → redirects to `/settings/business-profile`
- Retail onboarding (`/onboarding/retail`) → Step "business_profile" → redirects to `/settings/business-profile`
- Service/Professional onboarding → Step "business_profile" → redirects to `/settings/business-profile`
- Direct navigation to `/settings/business-profile` (settings menu)

**The component is NOT workspace-aware:**
- Does not receive `industry` or `workspace` as a prop
- Does not check `business.industry` to customize copy
- Shows the same UI and copy for all industries

### Is Workspace Passed Explicitly, Inferred, or Defaulted?

**INFERRED (but not used in business profile page):**

1. **Onboarding Pages Infer Workspace:**
   - `app/onboarding/page.tsx` (line 57): Checks `businessData.industry === "retail"` to redirect
   - `app/onboarding/retail/page.tsx` (line 59): Checks `businessData.industry !== "retail"` to redirect

2. **Business Profile Page Does NOT Use Workspace:**
   - The `/settings/business-profile` page loads business data (line 50)
   - But does NOT check `business.industry` to customize copy
   - Always shows generic professional/service copy

3. **Workspace is NOT Passed as Prop:**
   - Onboarding components do NOT pass `industry` or `workspace` to business profile page
   - Business profile page is a standalone route, not a child component
   - Navigation is via `router.push()`, not component composition

---

## SUMMARY OF CURRENT BEHAVIOR

### Entry Conditions
- **No business** → `/business-setup` → creates business → `/onboarding`
- **Business exists, industry = retail** → `/onboarding/retail`
- **Business exists, industry ≠ retail** → `/onboarding` (generic)
- **Business exists, onboarding_step = complete** → Normal app navigation

### Business Creation
- Creates business with `onboarding_step: "business_profile"`
- Creates `business_users` record with role "admin"
- **Explicit redirect** to `/onboarding` (no state update)

### Persistence
- **ONLY in database:** `businesses.onboarding_step` (TEXT column)
- **Default value:** `'business_profile'`
- **No client-side storage:** No sessionStorage/localStorage
- **Completion check:** `onboarding_step === "complete"`

### Reload Behavior
- **Always reads from database** on page mount
- **Defaults to first step** if `onboarding_step` is null/undefined/invalid
- **No resume logic:** If step is lost/reset, user starts from beginning

### Workspace Context
- **Business profile page is shared** across all workspaces
- **Copy is hardcoded** for professional/service: "Update your business information for professional invoices"
- **No workspace detection** in business profile page
- **Retail users see professional copy** because they're redirected to the same generic page

---

**END OF ANALYSIS**




