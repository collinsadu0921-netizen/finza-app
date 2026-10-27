import { describe, expect, it } from "@jest/globals"
import { getTrustedRequestMetadata } from "@/lib/audit/requestMetadata"

function request(headers: Record<string, string>) {
  return new Request("https://staging.example.test/api/test", { headers })
}

describe("getTrustedRequestMetadata", () => {
  it("uses the last valid x-forwarded-for address", () => {
    const meta = getTrustedRequestMetadata(
      request({
        "x-forwarded-for": "203.0.113.10, 198.51.100.20",
        "user-agent": "BrowserAgent/1.0",
      })
    )
    expect(meta.ipAddress).toBe("198.51.100.20")
    expect(meta.userAgent).toBe("BrowserAgent/1.0")
  })

  it("does not trust caller-supplied x-real-ip when x-forwarded-for is absent", () => {
    const meta = getTrustedRequestMetadata(
      request({
        "x-real-ip": "203.0.113.99",
        "user-agent": "BrowserAgent/1.0",
      })
    )
    expect(meta.ipAddress).toBeNull()
    expect(meta.userAgent).toBe("BrowserAgent/1.0")
  })

  it("skips a trailing invalid forwarded value", () => {
    const meta = getTrustedRequestMetadata(
      request({
        "x-forwarded-for": "198.51.100.20, unknown",
      })
    )
    expect(meta.ipAddress).toBe("198.51.100.20")
  })

  it("returns null metadata when no trusted headers exist", () => {
    const meta = getTrustedRequestMetadata(request({}))
    expect(meta.ipAddress).toBeNull()
    expect(meta.userAgent).toBeNull()
  })

  it("caps the user-agent length", () => {
    const meta = getTrustedRequestMetadata(
      request({ "user-agent": "a".repeat(700) })
    )
    expect(meta.userAgent).toHaveLength(500)
  })
})
