/** Safe server-side Supabase/PostgREST error logging (no auth material). */

export type SupabaseErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export function logSupabaseRpcFailure(
  route: string,
  rpc: string,
  businessId: string,
  error: SupabaseErrorLike | null | undefined,
  ms: number,
  extra?: Record<string, string | number | boolean | null | undefined>
): void {
  console.error(
    JSON.stringify({
      finza_rpc_error: true,
      route,
      rpc,
      business_id: businessId,
      ms: Math.round(ms * 10) / 10,
      code: error?.code ?? null,
      message: error?.message ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
      ...extra,
    })
  )
}

export function classifySupabaseError(error: SupabaseErrorLike | null | undefined): string {
  const msg = String(error?.message ?? "").toLowerCase()
  const code = String(error?.code ?? "")
  if (code === "57014" || msg.includes("statement timeout") || msg.includes("canceling statement")) {
    return "statement_timeout"
  }
  if (msg.includes("connection") && (msg.includes("pool") || msg.includes("timeout"))) {
    return "connection_pool"
  }
  if (code === "PGRST301" || msg.includes("jwt")) {
    return "auth_jwt"
  }
  if (code === "42501" || msg.includes("permission denied") || msg.includes("rls")) {
    return "rls_policy"
  }
  if (msg.includes("ambiguous")) return "ambiguous_column"
  if (msg.includes("overflow") || msg.includes("numeric")) return "numeric"
  return "unknown"
}
