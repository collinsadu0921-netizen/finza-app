# Cashier PIN Authentication & Register Sessions - Summary

## 📌 CASHIER PIN AUTHENTICATION

### Overview
Cashiers use a simple PIN code (4-6 digits) to access the POS system, separate from admin/manager email/password authentication.

### How It Works

#### 1. **Cashier Creation**
- Admin creates cashier in Staff Management (`/settings/staff`)
- Required fields:
  - Name
  - Store Assignment (required)
  - PIN Code (4-6 digits, numeric only)
- Optional: Email/Password (not used for cashier login)

#### 2. **PIN Login Flow**
```
Cashier → /pos/pin → Enters PIN → System Validates → POS Access
```

**Steps:**
1. Cashier navigates to `/pos/pin` (or `/pos` redirects there)
2. Enters 4-6 digit PIN code
3. System validates:
   - PIN format (numeric, 4-6 digits)
   - PIN exists in database
   - User has `cashier` role in `business_users`
   - User is assigned to a store
4. Creates cashier session in browser `sessionStorage`
5. Redirects to `/pos` (Point of Sale)

#### 3. **Session Management**
- **Storage**: Browser `sessionStorage` (cleared on browser close)
- **Data Stored**:
  ```typescript
  {
    cashierId: string,
    cashierName: string,
    storeId: string,
    businessId: string
  }
  ```
- **Security Features**:
  - Rate limiting (prevents brute force)
  - PIN uniqueness per store
  - Session expires on browser close

#### 4. **Cashier Access**
- **Can Access**:
  - `/pos` - Point of Sale interface
  - Products for their assigned store only
  - Make sales (when register is open)
  
- **Cannot Access**:
  - Admin dashboard
  - Settings pages
  - Reports
  - Staff management
  - Register open/close (must contact manager)

#### 5. **UI Isolation**
- Sidebar: **Hidden** for cashiers
- Top navigation: **Hidden** for cashiers
- Full-width POS interface
- Clean, cashier-only view

---

## 🔐 REGISTER SESSIONS

### Overview
Register sessions track cash drawer operations. Each session represents one cash drawer being used during a shift.

### Current System: **User-Based Sessions**

#### Rule
- **One open session per user** (admin/manager)
- Multiple registers can be open by different users
- One user cannot open multiple registers simultaneously

#### How It Works

**Opening a Session:**
1. Admin/Manager goes to `/sales/open-session`
2. Selects register (e.g., "Register 1")
3. Enters opening float (e.g., GHS 100.00)
4. System checks: Does this user already have an open session?
   - ✅ No → Creates session
   - ❌ Yes → Error: "You already have an open session"

**Session Data:**
```typescript
{
  register_id: string,
  user_id: string,        // Who opened it
  store_id: string,
  business_id: string,
  opening_float: number,
  status: "open" | "closed",
  started_at: timestamp
}
```

**Closing a Session:**
1. Admin/Manager goes to `/sales/close-session`
2. System calculates expected cash:
   - Expected = Opening Float + Cash Sales - Change Given
3. Manager enters counted cash (actual money in drawer)
4. System shows variance (difference)
5. If variance exists, may require override approval
6. Session marked as "closed"

### Cashier & Register Sessions

**Cashiers:**
- **Cannot** open register sessions
- **Cannot** close register sessions
- **Can** use POS only when register is open
- See blocking overlay if register is closed

**POS Behavior:**
- Checks for open register session on load
- If no session → Shows "Register is Closed" overlay
- If session exists → Full POS access
- All sales linked to the active register session

---

## 🔄 MULTIPLE SESSIONS DISCUSSION

### Current Limitation

**Problem:**
- Manager opens Register 1 for Cashier A
- Manager tries to open Register 2 for Cashier B
- **Error**: "You already have an open session"

**Impact:**
- Manager must close Register 1 before opening Register 2
- Cannot set up multiple registers simultaneously
- Not aligned with market standards (Square, Shopify POS, etc.)

### Market Standard

**Industry Best Practice:**
- ✅ Multiple registers can be open simultaneously
- ✅ One session per register (not per user)
- ✅ Manager can open Register 1, then Register 2, then Register 3
- ✅ Each register tracks cash independently

**Real-World Scenario:**
```
Morning Setup:
- Manager opens Register 1 (GHS 100) → Cashier A uses it
- Manager opens Register 2 (GHS 100) → Cashier B uses it
- Manager opens Register 3 (GHS 100) → Cashier C uses it
All three registers active simultaneously ✅
```

### Recommended Change

**From:** User-based sessions (one per user)
**To:** Register-based sessions (one per register)

**New Rule:**
- Check if **register** has open session (not user)
- Multiple registers can be open simultaneously
- One user can open multiple registers
- Each register maintains independent cash tracking

**Benefits:**
1. ✅ Market competitive
2. ✅ Flexible for managers
3. ✅ Supports multiple cashiers
4. ✅ Better scalability
5. ✅ Maintains cash accountability

---

## 📊 COMPARISON TABLE

| Feature | Current (User-Based) | Recommended (Register-Based) | Market Standard |
|---------|---------------------|------------------------------|-----------------|
| Multiple registers open | ✅ (different users) | ✅ (any user) | ✅ |
| One user, multiple registers | ❌ | ✅ | ✅ |
| Cash accountability | ✅ | ✅ | ✅ |
| Manager flexibility | ⚠️ Limited | ✅ Full | ✅ |
| Market competitive | ⚠️ | ✅ | ✅ |
| Multi-cashier support | ✅ | ✅ | ✅ |

---

## 🔧 TECHNICAL DETAILS

### PIN Authentication API
- **Endpoint**: `/api/auth/pin-login`
- **Method**: POST
- **Validation**:
  - PIN format: 4-6 digits
  - PIN exists in `users.pin_code`
  - User has `cashier` role in `business_users`
  - User assigned to store
- **Security**: Rate limiting by IP address

### Register Session Check
- **Function**: `getOpenRegisterSession()`
- **Location**: `lib/registerStatus.ts`
- **Query**: Finds open session for store today
- **Used by**: POS page to determine if sales allowed

### Database Tables
- **`users`**: Stores `pin_code` (4-6 digits, unique per store)
- **`business_users`**: Links users to businesses with `role` (admin/manager/cashier)
- **`cashier_sessions`**: Tracks register sessions
- **`registers`**: Physical register locations

---

## 🎯 KEY TAKEAWAYS

1. **Cashier PIN**: Simple, secure, store-scoped authentication
2. **Register Sessions**: Track cash drawer operations per shift
3. **Current Limitation**: One session per user (blocks multiple register setup)
4. **Recommended**: Switch to register-based sessions for market competitiveness
5. **Cashiers**: Limited to POS only, cannot manage registers
6. **Managers/Admins**: Control register sessions, cash reconciliation

---

## 🚀 NEXT STEPS

**To Implement Register-Based Sessions:**
1. Update `app/sales/open-session/page.tsx` - Change validation from user-based to register-based
2. Update `app/onboarding/retail/register.tsx` - Same change
3. Test multiple registers open simultaneously
4. Ensure backward compatibility
5. Update documentation

**Impact**: Makes Finza competitive with major POS systems while maintaining cash accountability.

