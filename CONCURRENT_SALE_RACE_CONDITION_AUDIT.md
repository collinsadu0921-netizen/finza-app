# Concurrent Sale Race Condition Audit

**Date:** 2025-01-27  
**Auditor:** Concurrency Analysis  
**Scenario:** Two POS terminals, same SKU, stock = 1, simultaneous sales  
**Purpose:** Identify overselling vulnerability and missing database guarantees

---

## Step-by-Step Concurrent Execution Sequence

### Terminal A Timeline

1. **Sale Record Creation (Line 256-311)**
   - Terminal A sends POST request to `/api/sales/create`
   - Application inserts row into `sales` table
   - Sale record committed immediately (no transaction wrapper)
   - Sale receives ID: `sale_a_id`

2. **Sale Items Creation (Line 335-458)**
   - Terminal A inserts rows into `sale_items` table for each item
   - Sale items committed immediately (no transaction wrapper)
   - Records linked to `sale_a_id`

3. **Stock Read Operation (Line 808-814)**
   - Terminal A queries `products_stock` table
   - SELECT statement: `SELECT id, stock_quantity, stock FROM products_stock WHERE product_id = X AND store_id = Y AND variant_id IS NULL`
   - Database returns current stock = 1
   - Application stores value in `currentStock` variable
   - No row lock acquired during read

4. **Stock Validation Check (Line 873)**
   - Terminal A compares: `currentStock (1) < quantitySold (1)` → false
   - Validation passes
   - Application proceeds to stock deduction

5. **Stock Calculation (Line 886)**
   - Terminal A calculates: `newStock = currentStock (1) - quantitySold (1) = 0`

6. **Stock Write Operation (Line 896-902)**
   - Terminal A executes UPDATE statement
   - `UPDATE products_stock SET stock = 0, stock_quantity = 0 WHERE id = stockRecordId`
   - Update committed immediately
   - Database executes update successfully

7. **Stock Movement Log (Line 960-974)**
   - Terminal A inserts row into `stock_movements` table
   - Audit record committed immediately
   - Sale completes successfully

### Terminal B Timeline (Concurrent Execution)

1. **Sale Record Creation (Line 256-311)**
   - Terminal B sends POST request to `/api/sales/create` (simultaneous with Terminal A)
   - Application inserts row into `sales` table
   - Sale record committed immediately
   - Sale receives ID: `sale_b_id`

2. **Sale Items Creation (Line 335-458)**
   - Terminal B inserts rows into `sale_items` table
   - Sale items committed immediately
   - Records linked to `sale_b_id`

3. **Stock Read Operation (Line 808-814)**
   - Terminal B queries `products_stock` table (occurs while Terminal A is still processing)
   - SELECT statement executes same query as Terminal A
   - Database returns current stock = 1 (Terminal A has not yet updated)
   - Application stores value in `currentStock` variable
   - No row lock acquired during read

4. **Stock Validation Check (Line 873)**
   - Terminal B compares: `currentStock (1) < quantitySold (1)` → false
   - Validation passes
   - Application proceeds to stock deduction

5. **Stock Calculation (Line 886)**
   - Terminal B calculates: `newStock = currentStock (1) - quantitySold (1) = 0`

6. **Stock Write Operation (Line 896-902)**
   - Terminal B executes UPDATE statement
   - `UPDATE products_stock SET stock = 0, stock_quantity = 0 WHERE id = stockRecordId`
   - Update committed immediately
   - Database executes update successfully (overwrites Terminal A's update)

7. **Stock Movement Log (Line 960-974)**
   - Terminal B inserts row into `stock_movements` table
   - Audit record committed immediately
   - Sale completes successfully

### Final State After Both Sales

- **sales table:** Contains two sale records (`sale_a_id`, `sale_b_id`)
- **sale_items table:** Contains sale items for both sales
- **products_stock table:** Shows stock = 0 (only one update survives)
- **stock_movements table:** Contains two movement records, both showing quantity_change = -1
- **Actual inventory:** Zero units remaining
- **Sales recorded:** Two sales completed for one unit of inventory

**Result:** Overselling occurred. Both sales succeeded, inventory went negative, customer received product that should have been sold out.

---

## Exact Location Where Overselling Occurs

The overselling vulnerability exists in the gap between stock read (step 3) and stock write (step 6). The system reads stock without acquiring a lock, validates availability using the read value, then updates stock based on that stale value. When two terminals execute these steps concurrently, both read stock = 1, both validate that stock is sufficient, and both proceed to decrement stock, resulting in two sales for one unit.

The race condition window spans from the SELECT query on `products_stock` (line 808-814) through the UPDATE query (line 896-902). During this window, if another sale process queries the same stock record, it will read the same value before either process has committed its update, leading to both processes believing stock is available.

---

## Missing Database Guarantees

### 1. No Row-Level Locking

The stock read operation uses a standard SELECT statement without any locking mechanism. There is no `SELECT FOR UPDATE` clause that would acquire an exclusive lock on the row, preventing other transactions from reading the same value until the lock is released. This allows multiple concurrent readers to see the same stock value simultaneously.

### 2. No Atomic Check-and-Update

The stock validation and stock update are separate operations with no atomic guarantee. The check happens in application code using a value read from the database, then the update happens in a subsequent database operation. There is no database-level constraint that ensures the stock value has not changed between the read and the write. A unique constraint, check constraint, or trigger-based validation could enforce this, but none exists.

### 3. No Database Transaction

The entire sale creation process executes without a database transaction wrapper. Each database operation (sale insert, sale items insert, stock read, stock update, stock movement insert) commits independently. Even if the stock update could detect the race condition, there is no transaction boundary to roll back the sale and sale items that were already committed. The system attempts manual rollback using DELETE statements, but this occurs after commits, creating a window where incomplete sales exist.

### 4. No Optimistic Locking

The stock update does not include a version check or timestamp comparison to detect concurrent modifications. The UPDATE statement uses only the row ID (`WHERE id = stockRecordId`) without verifying that the stock value matches what was read. If the update used a condition like `WHERE id = stockRecordId AND stock = currentStock`, the second concurrent update would fail because the stock value would have changed.

### 5. No Pessimistic Locking

The system does not acquire any locks before reading stock. There is no mechanism to queue concurrent sale requests for the same SKU, forcing them to execute sequentially. Multiple terminals can proceed in parallel, each reading and validating stock independently, leading to race conditions.

---

## Conclusion

The system is vulnerable to overselling when multiple POS terminals attempt to sell the same SKU simultaneously. The vulnerability stems from a read-then-write pattern executed without row-level locking, atomic operations, or database transactions. When two terminals read stock = 1 at the same time, both validate that stock is sufficient, both proceed to decrement stock, and both complete successfully, resulting in two sales for one unit of inventory. The system lacks the fundamental database guarantees (row locks, atomic check-and-update, transactions, optimistic or pessimistic locking) needed to prevent this race condition, making overselling inevitable under concurrent load.

---

**Assessment Complete - No Code Changes Made**
