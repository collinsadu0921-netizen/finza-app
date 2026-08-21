/**
 * Opt-in route timing logs for load-test / staging diagnosis.
 * Enable with FINZA_ROUTE_DIAG=1 (preview/staging only recommended).
 *
 * Never pass secrets, cookies, tokens, or raw session material in `fields`.
 */

import type { SupabaseErrorLike } from "@/lib/server/logSupabaseRpcError"
import { runtimeRegion } from "@/lib/server/buildInfo"
import { NextResponse } from "next/server"

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
  const serverTimings: Array<{ name: string; dur: number; desc?: string }> = []
  const region = runtimeRegion()
  if (region) {
    serverTimings.push({ name: "region", dur: 0, desc: region })
  }

  return {
    step(step: string, extra?: RouteDiagFields) {
      logRouteDiag(route, {
        ...base,
        step,
        ms: Math.round((performance.now() - routeT0) * 10) / 10,
        ...extra,
      })
    },
    /** Record a named duration for Server-Timing (milliseconds). */
    recordTiming(name: string, durMs: number, desc?: string) {
      serverTimings.push({
        name,
        dur: Math.round(durMs * 10) / 10,
        desc,
      })
    },
    serverTimingHeader(extra?: Array<{ name: string; dur: number; desc?: string }>) {
      return buildServerTimingHeader([...serverTimings, ...(extra ?? [])])
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

/** Build a `Server-Timing` header value (no sensitive data). */
export function buildServerTimingHeader(
  entries: Array<{ name: string; dur: number; desc?: string }>
): string | null {
  if (entries.length === 0) return null
  return entries
    .map((e) => {
      const parts = [`${e.name};dur=${e.dur}`]
      if (e.desc) parts.push(`desc="${e.desc.replace(/"/g, "'")}"`)
      return parts.join(";")
    })
    .join(", ")
}

export function jsonResponseWithServerTiming<T>(
  body: T,
  init: { status?: number; serverTiming?: string | null }
): NextResponse {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (init.serverTiming) {
    headers.set("Server-Timing", init.serverTiming)
  }
  return NextResponse.json(body, { status: init.status ?? 200, headers })
}
