import { assertStagingApiProbe, assertStagingIsolation, probeStagingApiKeys } from "../../lib/staging/stagingIsolation.ts"

const staticResult = assertStagingIsolation(process.env, { packageA: true })
if (!staticResult.ok) {
  console.error("Staging preflight failed.")
  for (const code of staticResult.errors) console.error(`- ${code}`)
  process.exit(1)
}

const probe = await probeStagingApiKeys(process.env)
const liveResult = assertStagingApiProbe(probe)
if (!liveResult.ok) {
  console.error("Staging API key probe failed.")
  console.error(`- publishable_http:${probe.publishable.http}`)
  console.error(`- publishable_auth:${probe.publishable.auth}`)
  console.error(`- secret_http:${probe.secret.http}`)
  console.error(`- secret_auth:${probe.secret.auth}`)
  for (const code of liveResult.errors) console.error(`- ${code}`)
  process.exit(1)
}

console.log("Staging preflight passed. Package A payment checks and staging API key probes are satisfied.")
