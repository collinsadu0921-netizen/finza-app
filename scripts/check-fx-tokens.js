#!/usr/bin/env node

/**
 * CI Script: Check for Foreign Currency (FX) Tokens in UI Folders
 * 
 * This script fails if FX-related tokens appear in UI folders (app/, components/)
 * except in allowlisted files. This prevents accidental use of foreign currency
 * features that are not fully supported end-to-end.
 * 
 * FX tokens checked:
 * - foreign_currency
 * - foreign_amount
 * - exchange_rate
 * - converted_ghs_amount
 * 
 * Allowlisted files:
 * - lib/currency.ts (currency utility functions)
 * - supabase/migrations/* (database migrations)
 * - app/api/payments/* (payment provider integrations)
 */

const fs = require('fs');
const path = require('path');

// FX tokens to check for (POS/sales-specific fields - not to be used in UI without proper FX pipeline)
// NOTE: Document FX fields (fx_rate, home_currency_code, home_currency_total) are intentional
// and supported end-to-end for invoices/quotes/proforma — they are NOT blocked by this guard.
const FX_TOKENS = [
  'foreign_currency',
  'foreign_amount',
  'exchange_rate',
  'converted_ghs_amount'
];

// Directories to check
const UI_DIRECTORIES = ['app', 'components'];

// Allowlisted file patterns (relative to project root)
const ALLOWLIST_PATTERNS = [
  /^lib\/currency\.ts$/,  // Currency utility functions
  /^supabase\/migrations\/.*\.sql$/,  // Database migrations
  /^app\/api\/payments\/.*\.ts$/,  // Payment provider integrations
  // Sales history pages - read-only display of historical FX data
  /^app\/sales-history\/.*\.tsx?$/,  // Sales history display pages
  /^app\/sales-history\/.*\/page\.tsx$/,  // Sales history detail pages
  /^app\/sales\/\[id\]\/receipt\/page\.tsx$/,  // Receipt page (read-only display)
  /^app\/api\/sales-history\/.*\.ts$/,  // Sales history API routes (read-only)
  /^components\/PaymentModal\.tsx$/,  // PaymentModal - FX UI disabled, types kept for backward compatibility
];

/**
 * Check if a file path matches any allowlist pattern
 */
function isAllowlisted(filePath) {
  // Normalize path separators and make relative to project root
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Remove leading './' or project root prefix if present
  const relativePath = normalizedPath.replace(/^(\.\/|.*\/finza-web\/)/, '');
  
  return ALLOWLIST_PATTERNS.some(pattern => pattern.test(relativePath));
}

/**
 * Check if a file contains any FX tokens
 */
function checkFileForFXTokens(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const foundTokens = [];
    
    FX_TOKENS.forEach(token => {
      // Use word boundary regex to avoid false positives
      const regex = new RegExp(`\\b${token}\\b`, 'g');
      if (regex.test(content)) {
        foundTokens.push(token);
      }
    });
    
    return foundTokens;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Recursively find all files in a directory
 */
function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and other common ignore directories
      if (!['node_modules', '.next', '.git', 'dist', 'build'].includes(file)) {
        findFiles(filePath, fileList);
      }
    } else if (stat.isFile()) {
      // Only check TypeScript/TSX files
      if (/\.(ts|tsx)$/.test(file)) {
        fileList.push(filePath);
      }
    }
  });
  
  return fileList;
}

/**
 * Main function
 */
function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const violations = [];
  
  console.log('🔍 Checking for FX tokens in UI folders...\n');
  console.log('Allowlisted files/patterns:');
  console.log('  - lib/currency.ts (currency utility functions)');
  console.log('  - supabase/migrations/*.sql (database migrations)');
  console.log('  - app/api/payments/*.ts (payment provider integrations)');
  console.log('  - app/sales-history/** (read-only display of historical FX data)');
  console.log('  - app/sales/[id]/receipt/page.tsx (read-only receipt display)');
  console.log('  - components/PaymentModal.tsx (FX UI disabled, types for backward compatibility)');
  console.log('');
  
  // Check each UI directory
  UI_DIRECTORIES.forEach(dir => {
    const dirPath = path.join(projectRoot, dir);
    
    if (!fs.existsSync(dirPath)) {
      console.warn(`⚠️  Directory ${dir} does not exist, skipping...`);
      return;
    }
    
    const files = findFiles(dirPath);
    
    files.forEach(file => {
      // Check if file is allowlisted
      if (isAllowlisted(file)) {
        return; // Skip allowlisted files
      }
      
      // Check for FX tokens
      const foundTokens = checkFileForFXTokens(file);
      
      if (foundTokens.length > 0) {
        const relativePath = path.relative(projectRoot, file);
        violations.push({
          file: relativePath,
          tokens: foundTokens
        });
      }
    });
  });
  
  // Report results
  if (violations.length > 0) {
    console.error('❌ FX token violations found:\n');
    
    violations.forEach(({ file, tokens }) => {
      console.error(`  ${file}`);
      console.error(`    Found tokens: ${tokens.join(', ')}`);
      console.error('');
    });
    
    console.error('Foreign currency (FX) features are not fully supported end-to-end.');
    console.error('Exchange rate capture, ledger posting, and reporting for foreign currency');
    console.error('are not fully implemented. Please use base business currency only.\n');
    console.error('If you need to use FX tokens, add the file to the allowlist in');
    console.error('scripts/check-fx-tokens.js\n');
    
    process.exit(1);
  } else {
    console.log('✅ No FX token violations found in UI folders.\n');
    process.exit(0);
  }
}

// Run the script
main();

