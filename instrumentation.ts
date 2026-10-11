export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.FINZA_DEPLOYMENT_ENV !== "staging") return

  const { assertStagingApiProbe, assertStagingIsolation, probeStagingApiKeys } = await import(
    "./lib/staging/stagingIsolation"
  )
  const staticResult = assertStagingIsolation(process.env)
  if (!staticResult.ok) {
    throw new Error(`Staging isolation check failed: ${staticResult.errors.join(", ")}`)
  }
  const probe = await probeStagingApiKeys(process.env)
  const liveResult = assertStagingApiProbe(probe)
  if (!liveResult.ok) {
    throw new Error(`Staging API key probe failed: ${liveResult.errors.join(", ")}`)
  }
}
