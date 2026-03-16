# Business Profile Save and Onboarding Progression - Current Code Analysis

This document explains exactly how Business Profile saving and onboarding progression currently work in the codebase, without suggesting fixes or improvements.

---

## 1. BUSINESS PROFILE SAVE

### Which File Handles Saving the Business Profile?

**File:** `app/api/business/profile/route.ts`
**Function:** `PUT` handler (lines 54-151)

### Which Business Fields Are Written to the Database on Save?

**Extracted from Request Body (lines 72-87):**
- `legal_name`
- `trading_name`
- `address_street`
- `address_city`
- `address_region`
- `address_country`
- `phone`
- `whatsapp_phone`
- `email`
- `website`
- `tin`
- `logo_url`
- `default_currency`
- `start_date`

**Update Logic (lines 89-106):**
- Creates `updateData` object with `updated_at: new Date().toISOString()`
- Conditionally adds fields: `if (field !== undefined) updateData.field = field`
- Only fields that are explicitly provided (not undefined) are included in the update
- Fields are updated even if they are empty strings or null

**Fields NOT Included in Business Profile Save:**
- `business.name` - **NOT extracted from request body, NOT updated**
- `business.industry` - NOT extracted, NOT updated
- `business.owner_id` - NOT extracted, NOT updated
- Any other fields not explicitly listed above

### Is `business.name` Required, Optional, or Conditionally Saved?

**Database Schema:** From `supabase/migrations/051_fix_all_table_structures.sql` line 167:
```sql
name TEXT NOT NULL
```

**Status:** `business.name` is **REQUIRED** (NOT NULL constraint in database)

**Business Profile Form:** From `app/settings/business-profile/page.tsx` lines 23-37:
- Form state (`formData`) includes: `legal_name`, `trading_name`, address fields, contact fields, etc.
- **NO `name` field exists in the form**
- The form does NOT collect or send `business.name`

**Business Creation:** From `app/business-setup/page.tsx` lines 78-88:
- Business is created with `name` field during initial setup: `name,` (line 82)
- This is the ONLY place where `business.name` is set

### Under What Conditions Could the Save Succeed Without a Name?

**Answer:** The save ALWAYS succeeds without updating `name` because:
1. The Business Profile API route does NOT attempt to update `business.name`
2. There is no validation that checks `business.name` exists or is set
3. The form does not provide a `name` field to update
4. The database NOT NULL constraint only applies at INSERT time, not UPDATE time (if `name` was already set during business creation, it cannot be set to NULL, but it's not validated during profile updates)

**Note:** Since `business.name` is set during business creation (`app/business-setup/page.tsx`), it should always exist. However, if a business was created through some other mechanism without a name, or if the name was somehow cleared, the Business Profile save would NOT restore it.

---

## 2. ONBOARDING INTERACTION

### Does Saving Business Profile Advance `businesses.onboarding_step`?

**YES**, but conditionally.

**Location:** `app/api/business/profile/route.ts` lines 108-124

**Condition Check (lines 110-113):**
```typescript
if (business.onboarding_step === "business_profile") {
  // Check if profile has minimum required fields
  const hasProfileData = (legal_name || trading_name) && (phone || email)
  if (hasProfileData) {
    // Advance to next step based on industry
    if (business.industry === "retail") {
      updateData.onboarding_step = "create_store"
    } else if (business.industry === "logistics") {
      updateData.onboarding_step = "add_rider"
    } else {
      // service, professional, or other
      updateData.onboarding_step = "add_customer"
    }
  }
}
```

**How It Works:**
1. Checks if current `business.onboarding_step === "business_profile"`
2. Validates that profile has minimum data: `(legal_name || trading_name) && (phone || email)`
3. If validation passes, sets `updateData.onboarding_step` to the next step based on industry
4. The `onboarding_step` update is included in the same database UPDATE statement (line 128)

**When Onboarding Does NOT Advance:**
- If `business.onboarding_step !== "business_profile"` (already past this step)
- If `hasProfileData` is false (missing both legal_name AND trading_name, OR missing both phone AND email)
- If the database update fails (but this would also fail the entire save)

---

## 3. SKIP ONBOARDING

### What Does "Skip onboarding" Do Exactly in Code?

**File:** `app/onboarding/page.tsx` lines 119-133
**Function:** `skipOnboarding`

**Code:**
```typescript
const skipOnboarding = async () => {
  await updateOnboardingStep("complete")
  
  if (business?.industry === "retail") {
    router.push("/pos")
  } else if (business?.industry === "service") {
    router.push("/dashboard")
  } else if (business?.industry === "professional") {
    router.push("/clients")
  } else if (business?.industry === "logistics") {
    router.push("/rider/dashboard")
  } else {
    router.push("/dashboard")
  }
}
```

**What `updateOnboardingStep("complete")` Does (lines 82-98):**
```typescript
const updateOnboardingStep = async (step: OnboardingStep) => {
  try {
    const { error } = await supabase
      .from("businesses")
      .update({ onboarding_step: step })
      .eq("id", businessId)

    if (error) {
      console.error("Error updating onboarding step:", error)
      return
    }

    setCurrentStep(step)
  } catch (err) {
    console.error("Error updating onboarding step:", err)
  }
}
```

**Exact Behavior:**
1. Directly updates `businesses.onboarding_step = "complete"` in database
2. Updates local state `currentStep = "complete"`
3. Redirects to industry-specific route (POS, dashboard, clients, etc.)
4. **NO validation, NO checks, NO verification of business completeness**

### Does It Validate Business Completeness Before Setting step = complete?

**NO.** There is no validation whatsoever.

**Evidence:**
- No checks for `business.name`
- No checks for `legal_name` or `trading_name`
- No checks for contact information (phone, email)
- No checks for address
- No checks for any business data
- The function simply sets `onboarding_step = "complete"` and redirects

### Can It Mark Onboarding Complete Even If Business Data Is Missing?

**YES.** The code explicitly allows this behavior.

**What Happens:**
- `skipOnboarding()` calls `updateOnboardingStep("complete")`
- `updateOnboardingStep()` performs: `UPDATE businesses SET onboarding_step = 'complete' WHERE id = businessId`
- This update will succeed as long as the business record exists
- No validation prevents this
- The database constraint on `businesses.name` (NOT NULL) only prevents INSERT without name, not UPDATE of onboarding_step

---

## 4. RESULTING STATE

### How Can the System End Up With onboarding_step = complete but business.name Missing?

**Scenario Analysis:**

**Scenario 1: Business Created Without Name (Theoretical)**
- If business was created through a mechanism other than `app/business-setup/page.tsx`
- Database constraint `name TEXT NOT NULL` would prevent this at INSERT time
- **Conclusion:** This scenario is prevented by database constraint

**Scenario 2: Business Name Was Never Set (Edge Case)**
- If business creation somehow succeeded with NULL name (database migration bug, direct SQL, etc.)
- User completes Business Profile (which doesn't update `name`)
- User clicks "Skip onboarding"
- Result: `onboarding_step = "complete"`, `business.name = NULL` (violates NOT NULL, but if it exists, this is the state)

**Scenario 3: Business Name Exists, But User Expects It To Be Updated**
- Business created with `name = "My Business"` (from business-setup)
- User goes to Business Profile page
- User sees `legal_name` and `trading_name` fields
- User fills in `legal_name = "My Legal Business Name Inc."`
- User saves Business Profile
- Business Profile save updates `legal_name` but does NOT update `name`
- `business.name` remains "My Business"
- User clicks "Skip onboarding"
- Result: `onboarding_step = "complete"`, `business.name = "My Business"` (original value)

**Note:** The user's report says "business name ends up missing" - this suggests `business.name` might actually be NULL or empty, which would be a data integrity issue, but the code does NOT validate this before allowing onboarding completion.

### Is This Behavior Explicitly Allowed by the Current Code?

**YES.** The code explicitly allows this behavior in multiple ways:

1. **Business Profile Save Does Not Validate `name`:**
   - No check that `business.name` exists before allowing save
   - No attempt to update `business.name` from profile data

2. **Skip Onboarding Does Not Validate Anything:**
   - `skipOnboarding()` function has zero validation
   - No checks before setting `onboarding_step = "complete"`
   - No validation of business completeness

3. **Onboarding Step Advancement Does Not Validate `name`:**
   - The Business Profile save only validates: `(legal_name || trading_name) && (phone || email)`
   - It does NOT check `business.name`
   - It does NOT require `business.name` to exist

4. **No Database-Level Validation:**
   - While `businesses.name` has NOT NULL constraint, this only applies at INSERT
   - UPDATE operations that don't touch `name` will succeed even if name is somehow missing
   - No CHECK constraint validates that `onboarding_step = "complete"` requires `name IS NOT NULL`

**Conclusion:** The current code has NO safeguards to prevent `onboarding_step = "complete"` when `business.name` is missing. The behavior is not explicitly prevented, and therefore is implicitly allowed.

---

## SUMMARY OF CURRENT BEHAVIOR

1. **Business Profile Save:**
   - Updates: `legal_name`, `trading_name`, address fields, contact fields, logo, currency, start_date
   - Does NOT update: `business.name`
   - Advances `onboarding_step` if `(legal_name || trading_name) && (phone || email)`
   - No validation of `business.name`

2. **Skip Onboarding:**
   - Directly sets `onboarding_step = "complete"`
   - NO validation of any business data
   - NO check for `business.name`
   - NO checks for completeness

3. **Resulting State:**
   - System CAN end up with `onboarding_step = "complete"` and missing/incorrect `business.name`
   - This behavior is NOT prevented by current code
   - Business Profile form does not collect `name`, so users cannot update it during onboarding
   - Skip onboarding allows completion regardless of business data state

---

**END OF ANALYSIS**




