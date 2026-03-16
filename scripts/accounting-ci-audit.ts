#!/usr/bin/env ts-node
/**
 * Phase 13: Accounting Invariant CI Audit Script
 * 
 * Runs accounting invariant audits before deploy/merge to prevent regressions.
 * 
 * Usage:
 *   BUSINESS_ID=<uuid> ts-node scripts/accounting-ci-audit.ts
 *   BUSINESS_ID=<uuid> LIMIT_PERIODS=3 ts-node scripts/accounting-ci-audit.ts
 * 
 * Exit codes:
 *   0: All invariants pass
 *   1: One or more invariants fail
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration from environment
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUSINESS_ID = process.env.BUSINESS_ID;
const LIMIT_PERIODS = parseInt(process.env.LIMIT_PERIODS || '3', 10);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  console.error('   Set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   Set SUPABASE_SERVICE_ROLE_KEY (use service role for read-only CI)');
  process.exit(1);
}

if (!BUSINESS_ID) {
  console.error('ERROR: BUSINESS_ID environment variable is required');
  console.error('   Set BUSINESS_ID to a valid UUID for the business to audit');
  process.exit(1);
}

// Create Supabase client with service role (read-only sufficient, but service role bypasses RLS)
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface PeriodAuditResult {
  period_id: string;
  period_start: string;
  period_end: string;
  status: string;
  overall_status: 'PASS' | 'FAIL';
  failed_checks?: string[];
  invariants?: Record<string, any>;
}

interface AuditSummary {
  business_id: string;
  overall_status: 'PASS' | 'FAIL';
  total_periods_audited: number;
  passed_periods: number;
  failed_periods: number;
  audit_timestamp: string;
  periods: PeriodAuditResult[];
}

/**
 * Run accounting invariant audit for a business
 */
async function runAccountingCIAudit(): Promise<number> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 13: Accounting Invariant CI Audit');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Business ID: ${BUSINESS_ID}`);
  console.log(`Limit periods: ${LIMIT_PERIODS}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log('');

  try {
    // Call run_business_accounting_audit database function
    const { data: auditResult, error } = await supabase.rpc('run_business_accounting_audit', {
      p_business_id: BUSINESS_ID,
      p_limit_periods: LIMIT_PERIODS
    });

    if (error) {
      console.error('ERROR: Failed to run accounting invariant audit');
      console.error(`   Error: ${error.message}`);
      console.error(`   Details: ${JSON.stringify(error, null, 2)}`);
      return 1;
    }

    if (!auditResult) {
      console.error('ERROR: No audit result returned');
      return 1;
    }

    // Parse audit result (should be JSONB from database)
    const summary: AuditSummary = auditResult;
    const failed: PeriodAuditResult[] = (summary.periods || []).filter(p => p.overall_status === 'FAIL');

    // Print summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('AUDIT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Overall Status:  ${summary.overall_status}`);
    console.log(`Periods audited: ${summary.total_periods_audited || 0}`);
    console.log(`Periods passed:  ${summary.passed_periods || 0}`);
    console.log(`Periods failed:  ${summary.failed_periods || 0}`);
    console.log('');

    // Print failed periods if any
    if (failed.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('FAILED PERIODS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      for (const period of failed) {
        console.log(`\nPeriod: ${period.period_start} → ${period.period_end} (${period.status})`);
        console.log(`  Period ID: ${period.period_id}`);
        console.log(`  Overall Status: ${period.overall_status}`);
        
        if (period.failed_checks && period.failed_checks.length > 0) {
          console.log(`  Failed Checks (${period.failed_checks.length}):`);
          for (const check of period.failed_checks) {
            console.log(`    - ${check}`);
          }
        }
        
        if (period.invariants) {
          const invariants = period.invariants;
          for (const [key, value] of Object.entries(invariants)) {
            if (value && typeof value === 'object' && 'status' in value && value.status === 'FAIL') {
              const failureReason = (value as any).failure_reason || JSON.stringify(value);
              console.log(`    ${key}: FAIL - ${failureReason}`);
            }
          }
        }
      }
      console.log('');
      return 1; // Exit with error code
    } else {
      console.log('✅ All accounting invariants passed for audited periods');
      console.log('');
      return 0; // Exit successfully
    }
  } catch (err: any) {
    console.error('ERROR: Unexpected error during audit');
    console.error(`   Error: ${err.message}`);
    console.error(`   Stack: ${err.stack}`);
    return 1;
  }
}

// Main execution
const exitCode = await runAccountingCIAudit();
process.exit(exitCode);
