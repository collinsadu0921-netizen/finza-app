/**
 * Re-export: subscription tier checks for shared APIs (payroll, bills, assets,
 * etc.) used outside accountant workspace routes.
 *
 * Skips enforcement when the user is an accounting firm member or the business
 * is not service/professional industry — same behavior as accounting helper.
 */

export { enforceServiceIndustryBusinessTierForAccountingApi as enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
