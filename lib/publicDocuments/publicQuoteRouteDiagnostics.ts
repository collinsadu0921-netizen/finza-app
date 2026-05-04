/**
 * Server-only diagnostics for public quote token lookups.
 * Never log full tokens; omit sensitive values from client responses.
 */

type SupabaseErr = {
  message?: string
  code?: string
  details?: string
  hint?: string
}

export function logPublicQuoteEstimateFetch(params: {
  token: string
  outcome: "ok" | "no_row" | "supabase_error"
  error?: SupabaseErr | null
}) {
  const { token, outcome, error } = params
  const tokenLength = token.length
  const tokenPrefix = tokenLength === 0 ? "" : `${token.slice(0, 6)}…`
  const payload = {
    scope: "public-quote",
    outcome,
    tokenLength,
    tokenPrefix,
    supabaseCode: error?.code ?? null,
    supabaseMessage: error?.message ?? null,
    supabaseDetails: error?.details ?? null,
    supabaseHint: error?.hint ?? null,
  }
  if (outcome === "supabase_error") {
    console.error("[public-quote] estimate fetch", JSON.stringify(payload))
  } else {
    console.info("[public-quote] estimate fetch", JSON.stringify(payload))
  }
}
