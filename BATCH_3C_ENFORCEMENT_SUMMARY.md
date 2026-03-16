# Batch 3C Enforcement Summary: Register Workflow Invariants

## Overview
Implemented register default enforcement to prevent "Main Register" duplication and forced selection. Exactly one default register per store is now enforced at the database level.

## Files Changed

### 1. Database Migration

#### `supabase/migrations/127_register_default_enforcement.sql` (NEW)
- **Purpose**: Add default register enforcement
- **Changes**:
  - Added `is_default` boolean column to `registers` table (default: false, NOT NULL)
  - Created index for default register lookups
  - Backfilled existing data: sets earliest created register (preferring "Main Register" name) as default for each store
  - Fixed multiple defaults: ensures only one default per store exists
  - Created trigger function `enforce_single_default_register()` to automatically clear other defaults when one is set
  - Created trigger to enforce single default on INSERT/UPDATE
  - Created unique partial indexes to prevent multiple defaults per store/business

### 2. Onboarding Flow

#### `app/onboarding/retail/register.tsx`
- **Changes**:
  - **Removed auto-creation**: No longer auto-creates "Main Register" if registers exist
  - **User creation**: Added `handleCreateRegister()` function to allow user to explicitly create a register
  - **Default setting**: When user creates first register for store, it's automatically set as default
  - **Default selection**: Preselects default register if available, otherwise first register
  - **UI**: Shows message and button to create register if none exist
  - **Ordering**: Orders registers by default first, then creation date (not name)

### 3. Open Session Flow

#### `app/sales/open-session/page.tsx`
- **Changes**:
  - **Default semantics**: Uses default register instead of alphabetical ordering
  - **Ordering**: Orders by `is_default DESC, created_at ASC` (not `name ASC`)
  - **Preselection**: Automatically preselects default register if available
  - **Fallback**: Falls back to first register if no default set

### 4. Register Settings

#### `app/settings/registers/page.tsx`
- **Changes**:
  - **Default setting**: When creating first register for store, automatically sets `is_default = true`
  - **Ordering**: Orders by default first, then creation date (not name)
  - **UI**: Added "Status" column to show which register is default
  - **Type**: Added `is_default` to Register type

## Key Changes Summary

### Default Register Concept
1. ✅ **Database Column**: `is_default` boolean column added
2. ✅ **Uniqueness**: Exactly one default per store enforced via trigger and unique index
3. ✅ **Backfill**: Existing data safely backfilled (earliest register per store set as default)

### Onboarding Changes
1. ✅ **No Auto-Creation**: Does not auto-create "Main Register" if registers exist
2. ✅ **User Control**: User must explicitly create register via button
3. ✅ **Default Assignment**: First register for store is automatically set as default
4. ✅ **Default Selection**: Preselects default register

### Open Session Changes
1. ✅ **Default Semantics**: Uses default register, not alphabetical ordering
2. ✅ **Preselection**: Automatically preselects default register
3. ✅ **Ordering**: Orders by default first, then creation date

### Settings Changes
1. ✅ **Default Assignment**: First register for store automatically set as default
2. ✅ **UI Display**: Shows which register is default
3. ✅ **Ordering**: Orders by default first, then creation date

## Database Enforcement

### Trigger Function
- **Name**: `enforce_single_default_register()`
- **Behavior**: When a register is set as default, automatically clears other defaults for the same store
- **Scope**: Per store (or per business if store_id is NULL)

### Unique Constraints
- **Index 1**: `idx_registers_one_default_per_store` - One default per store (where store_id IS NOT NULL)
- **Index 2**: `idx_registers_one_default_per_business` - One default per business (where store_id IS NULL)

### Backfill Logic
1. For each store, finds earliest created register
2. Prefers registers with "Main Register" in name
3. Sets as default
4. Fixes any multiple defaults (keeps earliest, clears others)

## Acceptance Criteria Met

✅ **Exactly ONE default register per store**
- Database constraint enforces uniqueness
- Trigger automatically clears other defaults when one is set

✅ **Onboarding does NOT create "Main Register" if registers exist**
- Checks for existing registers before auto-creating
- User must explicitly create register if none exist

✅ **Open Register uses default semantics, not alphabetical**
- Orders by `is_default DESC, created_at ASC`
- Preselects default register

✅ **No duplicate "Main Register" creation**
- Onboarding no longer auto-creates if registers exist
- Settings page sets default when creating first register
- Database prevents multiple defaults

## Testing Recommendations

1. **Onboarding (No Registers)**:
   - Start onboarding with no registers
   - Should show "Create Register" button
   - Create register → Should be set as default
   - Open session → Should preselect created register

2. **Onboarding (Registers Exist)**:
   - Start onboarding with existing registers
   - Should NOT auto-create "Main Register"
   - Should show existing registers
   - Should preselect default register

3. **Open Session**:
   - With default register → Should preselect default
   - Without default → Should preselect first register (by creation date)
   - Ordering should be default first, not alphabetical

4. **Settings Page**:
   - Create first register for store → Should be set as default
   - Create second register → Should NOT be set as default
   - Default register should show "Default" badge
   - Ordering should be default first

5. **Database Enforcement**:
   - Try to set multiple registers as default → Should only allow one
   - Trigger should automatically clear other defaults

## Notes

- **Scope**: Only register workflow. POS product visibility and unrelated files unchanged.
- **Breaking Changes**: None - existing data is backfilled safely.
- **Migration Safety**: Backfill logic handles edge cases (multiple defaults, NULL store_id, etc.)



