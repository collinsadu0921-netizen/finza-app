/**
 * Pre-Execution Gate Verification Script
 * Step 9.1 Batch F — Action 3
 * 
 * Verifies test environment before executing test suites
 */

const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('Pre-Execution Gate Verification');
console.log('Step 9.1 Batch F — Action 3');
console.log('========================================\n');

let allChecksPassed = true;

// Check 1: .env.test exists
console.log('1. Checking .env.test file...');
if (fs.existsSync(path.join(process.cwd(), '.env.test'))) {
  console.log('   ✅ .env.test file exists');
} else {
  console.log('   ❌ .env.test file NOT FOUND');
  allChecksPassed = false;
}

// Check 2: Required environment variables
console.log('\n2. Checking required environment variables...');
const requiredVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TEST_FIRM_ID',
  'TEST_BUSINESS_ID',
  'TEST_PARTNER_USER_ID',
  'TEST_OPEN_PERIOD_ID',
];

// Try to load .env.test
let envVars = {};
if (fs.existsSync(path.join(process.cwd(), '.env.test'))) {
  const envContent = fs.readFileSync(path.join(process.cwd(), '.env.test'), 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

requiredVars.forEach(varName => {
  const value = envVars[varName] || process.env[varName];
  if (value && value !== `YOUR_${varName}` && !value.includes('YOUR_')) {
    console.log(`   ✅ ${varName} is set`);
  } else {
    console.log(`   ❌ ${varName} is missing or not configured`);
    allChecksPassed = false;
  }
});

// Check 3: NODE_ENV
console.log('\n3. Checking NODE_ENV...');
if (process.env.NODE_ENV === 'test') {
  console.log('   ✅ NODE_ENV=test');
} else {
  console.log('   ⚠️  NODE_ENV is not set to "test" (will be set by test runner)');
}

// Check 4: Test database URL points to test project
console.log('\n4. Verifying test database URL...');
const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  if (supabaseUrl.includes('test') || supabaseUrl.includes('localhost')) {
    console.log('   ✅ Test database URL appears to be test project');
  } else {
    console.log('   ⚠️  WARNING: Database URL does not contain "test" - ensure this is test DB!');
    console.log(`   URL: ${supabaseUrl.substring(0, 50)}...`);
  }
} else {
  console.log('   ❌ Test database URL not found');
  allChecksPassed = false;
}

// Check 5: Test files exist
console.log('\n5. Checking test files exist...');
const testFiles = [
  'lib/accounting/__tests__/openingBalanceImports.test.ts',
  'app/api/accounting/opening-balances/__tests__/lifecycle.test.ts',
  'app/api/accounting/opening-balances/__tests__/posting-idempotency.test.ts',
  'app/api/accounting/opening-balances/__tests__/duplicate-protection.test.ts',
  'app/api/accounting/opening-balances/__tests__/period-lock-enforcement.test.ts',
  'app/api/accounting/opening-balances/__tests__/authority-enforcement.test.ts',
  'app/api/accounting/opening-balances/__tests__/audit-trail.test.ts',
];

testFiles.forEach(testFile => {
  const filePath = path.join(process.cwd(), testFile);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${testFile}`);
  } else {
    console.log(`   ❌ ${testFile} NOT FOUND`);
    allChecksPassed = false;
  }
});

// Summary
console.log('\n========================================');
if (allChecksPassed) {
  console.log('✅ ALL PRE-EXECUTION CHECKS PASSED');
  console.log('Ready to execute test suites');
  process.exit(0);
} else {
  console.log('❌ PRE-EXECUTION CHECKS FAILED');
  console.log('Please fix the issues above before running tests');
  process.exit(1);
}
