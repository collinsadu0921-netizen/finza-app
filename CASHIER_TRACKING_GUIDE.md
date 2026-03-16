# Cashier Sales Tracking Guide

## ✅ Fixed: Cashiers Cannot Switch Registers

**Problem**: Cashiers were able to switch between registers using the "Switch" button.

**Solution**: 
- Added role check: `userRole !== "cashier"` to hide the "Switch" button
- Added role check to the register picker modal
- Cashiers now auto-select the first available register and cannot change it

---

## 📊 Where to Track Cashier Sales

### 1. **Sales History Page** (`/sales-history`)

**Location**: Main navigation → Sales History

**Features**:
- ✅ **Cashier Filter**: Dropdown to filter sales by specific cashier
- ✅ **Cashier Column**: Shows cashier name for each sale
- ✅ **Register Column**: Shows which register was used
- ✅ **Date Range Filter**: Filter by date range
- ✅ **Payment Method Filter**: Filter by payment type
- ✅ **Status Filter**: Filter by sale status (completed, voided, etc.)

**How to Use**:
1. Go to `/sales-history`
2. Use the **"Cashier"** dropdown filter (6th filter column)
3. Select a cashier name from the list
4. Optionally add date range, payment method, or register filters
5. View all sales for that cashier

**What You See**:
- Sale ID (clickable to view details)
- Date/Time
- **Cashier Name** (prominently displayed)
- Register Name
- Amount
- Payment Method
- Status
- Actions (View Receipt, View Details)

---

### 2. **Sale Detail Page** (`/sales-history/[id]`)

**Location**: Click any Sale ID in the sales history table

**Features**:
- ✅ Full sale details
- ✅ Cashier information
- ✅ Register information
- ✅ All items sold
- ✅ Payment breakdown
- ✅ Tax breakdown
- ✅ Stock movements

---

### 3. **Cash Office Report** (`/reports/cash-office`)

**Location**: Reports → Cash Office Report

**Features**:
- ✅ Sales by register session
- ✅ Cashier information per session
- ✅ Opening/closing cash amounts
- ✅ Variance tracking
- ✅ Sales summary by cashier

**How to Use**:
1. Go to `/reports/cash-office`
2. Select date range
3. Optionally filter by register or cashier
4. View detailed cash reconciliation

---

## 🔍 Cashier Information in Sales

### Database Fields:
- `sales.user_id` - The cashier who made the sale
- `sales.cashier_session_id` - The register session ID
- `sales.register_id` - The register used

### Display:
- Cashier name is shown in the **"Cashier"** column
- Cashier email is available in the sale detail view
- Register name is shown in the **"Register"** column

---

## 📋 Filtering by Cashier

### In Sales History:
1. **Cashier Dropdown**: Select a cashier from the filter
2. **Date Range**: Combine with date filters for specific periods
3. **Register Filter**: Further filter by register if needed
4. **Payment Method**: Filter by payment type

### Example Workflow:
```
1. Select "John Doe" from Cashier filter
2. Set Date From: 2025-01-01
3. Set Date To: 2025-01-31
4. Click "Apply Filters"
5. View all of John Doe's sales for January
```

---

## 🎯 Best Practices

1. **Daily Review**: Check sales history daily to track cashier performance
2. **Filter by Date**: Always use date range filters for accurate reporting
3. **Combine Filters**: Use cashier + date + register for detailed analysis
4. **Export**: Use browser print/save to export filtered results
5. **Cash Office Report**: Use for end-of-day cash reconciliation

---

## 🔒 Security

- ✅ Cashiers **cannot** switch registers
- ✅ Cashiers **cannot** view sales history (redirected to POS)
- ✅ Only admins, managers, and employees can view sales history
- ✅ Cashier filter shows all cashiers in the business
- ✅ Register filter shows all registers (filtered by store for managers)

---

## 📝 Summary

**To Track a Cashier's Sales**:
1. Go to **Sales History** (`/sales-history`)
2. Use the **Cashier** filter dropdown
3. Select the cashier's name
4. Apply date range if needed
5. View all their sales in the table

**Cashier Column**:
- Shows cashier name prominently
- "N/A" if cashier info is missing
- Click any sale to see full details

**Register Switching**:
- ✅ **Fixed**: Cashiers can no longer switch registers
- ✅ Cashiers auto-select first available register
- ✅ Only admins/managers can switch registers

---

**Last Updated**: 2025-01-24





