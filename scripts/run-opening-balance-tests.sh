#!/bin/bash
# Step 9.1 Batch F — Test Execution Script
# Run all opening balance import test suites

set -e  # Exit on error

echo "=========================================="
echo "Step 9.1 Batch F — Test Execution"
echo "=========================================="
echo ""

# Load test environment
export NODE_ENV=test
if [ -f .env.test ]; then
  export $(cat .env.test | grep -v '^#' | xargs)
  echo "✅ Loaded .env.test"
else
  echo "⚠️  Warning: .env.test not found"
fi

echo "Environment: $NODE_ENV"
if [ ! -z "$NEXT_PUBLIC_SUPABASE_URL" ]; then
  echo "Test Database: $NEXT_PUBLIC_SUPABASE_URL"
else
  echo "❌ Error: NEXT_PUBLIC_SUPABASE_URL not set"
  exit 1
fi
echo ""

# Test suites in execution order
TEST_SUITES=(
  "lib/accounting/__tests__/openingBalanceImports.test.ts"
  "app/api/accounting/opening-balances/__tests__/lifecycle.test.ts"
  "app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts"
  "app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts"
  "app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts"
  "app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts"
  "app/api/accounting/opening-balances/__tests__/audit-trail.test.ts"
)

TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0

echo "Running test suites..."
echo ""

for test_file in "${TEST_SUITES[@]}"; do
  if [ ! -f "$test_file" ]; then
    echo "⚠️  Warning: Test file not found: $test_file"
    continue
  fi
  
  echo "----------------------------------------"
  echo "Running: $test_file"
  echo "----------------------------------------"
  
  # Run test and capture output
  if npm test -- "$test_file" --verbose; then
    echo "✅ PASSED: $test_file"
    ((TOTAL_PASSED++))
  else
    echo "❌ FAILED: $test_file"
    ((TOTAL_FAILED++))
  fi
  echo ""
done

echo "=========================================="
echo "Test Execution Summary"
echo "=========================================="
echo "Total Suites: ${#TEST_SUITES[@]}"
echo "Passed: $TOTAL_PASSED"
echo "Failed: $TOTAL_FAILED"
echo ""

if [ $TOTAL_FAILED -eq 0 ]; then
  echo "✅ ALL TEST SUITES PASSED"
  exit 0
else
  echo "❌ SOME TEST SUITES FAILED"
  exit 1
fi
