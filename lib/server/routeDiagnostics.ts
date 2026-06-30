/**
 * Opt-in route timing logs for load-test / staging diagnosis.
 * Enable with FINZA_ROUTE_DIAG=1 (preview/staging only recommended).
 *
 * Never pass secrets, cookies, tokens, or raw session material in `fields`.
 */

import type { SupabaseErrorLike } from "@/lib/server/logSupabaseRpcError"

export function isRouteDiagnosticsEnabled(): boolean {
  const v = process.env.FINZA_ROUTE_DIAG?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

export type RouteDiagFields = Record<
  string,
  string | number | boolean | null | undefined
>

export function timedStepMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

export function supabaseErrorDiag(
  error: SupabaseErrorLike | null | undefined
): RouteDiagFields {
  return {
    error_code: error?.code ?? null,
    error_message: error?.message ?? null,
    error_details: error?.details ?? null,
    error_hint: error?.hint ?? null,
  }
}

export function logRouteDiag(route: string, fields: RouteDiagFields): void {
  if (!isRouteDiagnosticsEnabled()) return
  console.info(
    JSON.stringify({
      finza_route_diag: true,
      route,
      at: new Date().toISOString(),
      ...fields,
    })
  )
}

export function createRouteDiag(route: string, businessId?: string | null) {
  const routeT0 = performance.now()
  const base: RouteDiagFields = businessId ? { business_id: businessId } : {}

  return {
    step(step: string, extra?: RouteDiagFields) {
      logRouteDiag(route, {
        ...base,
        step,
        ms: Math.round((performance.now() - routeT0) * 10) / 10,
        ...extra,
      })
    },
    finish(status: number, extra?: RouteDiagFields) {
      logRouteDiag(route, {
        ...base,
        step: "total",
        status,
        ms: Math.round((performance.now() - routeT0) * 10) / 10,
        ...extra,
      })
    },
    fail(status: number, error: string, extra?: RouteDiagFields) {
      logRouteDiag(route, {
        ...base,
        step: "error",
        status,
        error,
        ms: Math.round((performance.now() - routeT0) * 10) / 10,
        ...extra,
      })
    },
  }
}
