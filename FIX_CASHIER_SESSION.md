# Fix: Why You're Seeing Cashier Restrictions

## Your Current Status
- **Effective Role**: Owner ✅ (You own the business)
- **business_users Role**: Employee ⚠️ (Should be admin/owner)

## The Problem
Even though you're the business owner, you might be seeing cashier restrictions because:

1. **Active Cashier PIN Session** (Most Likely)
   - You logged in via PIN at `/pos/pin` at some point
   - This created a cashier session in `sessionStorage`
   - The cashier session overrides your admin/owner role

2. **business_users Role Mismatch**
   - Your role in `business_users` table is "employee"
   - Should be "admin" or "owner" to match your ownership

## Quick Fixes

### Fix 1: Clear Cashier Session (Do This First!)

**In Browser Console (F12):**
```javascript
// Clear all cashier session data
sessionStorage.removeItem('finza_cashier_session')
sessionStorage.removeItem('finza_cashier_store_id')
sessionStorage.removeItem('finza_cashier_store_name')

// Or clear all sessionStorage
sessionStorage.clear()

// Reload the page
location.reload()
```

**Or simply:**
- Close the browser tab/window completely
- Open a new tab and log in again

### Fix 2: Update Your Role in Database

Run this SQL in Supabase SQL Editor:

```sql
-- Update your role from 'employee' to 'admin'
UPDATE business_users 
SET role = 'admin' 
WHERE user_id = (
  SELECT id FROM users WHERE LOWER(email) = LOWER('Testing@retail.com')
)
AND role = 'employee';

-- Verify the update
SELECT 
  bu.role,
  b.name as business_name,
  u.email,
  u.full_name
FROM business_users bu
JOIN businesses b ON b.id = bu.business_id
JOIN users u ON u.id = bu.user_id
WHERE LOWER(u.email) = LOWER('Testing@retail.com');
```

## After Fixing

1. **Clear the cashier session** (Fix 1)
2. **Update your role** (Fix 2)
3. **Log out and log back in** with your email/password (not PIN)
4. You should now have full admin/owner access

## Why This Happened

- Cashier PIN login creates a separate session that overrides your normal role
- The `business_users` table had your role as "employee" instead of "admin"
- The system checks `business_users` role first, then checks if you're the owner

## Prevention

- Don't use PIN login unless you're actually a cashier
- If you need to test cashier features, use a separate cashier account
- Keep your `business_users` role as "admin" or "owner" to match your ownership





