import { describe, it, expect } from "@jest/globals"
import {
  composeInboundRecipientAddress,
  generateOpaqueInboundLocalPart,
  isValidOpaqueLocalPart,
} from "@/lib/businessInboundEmail/inboundEmailRouteManagement"

describe("inboundEmailRouteManagement helpers", () => {
  it("generates stable-shape opaque local parts", () => {
    const a = generateOpaqueInboundLocalPart()
    const b = generateOpaqueInboundLocalPart()
    expect(a).not.toBe(b)
    expect(isValidOpaqueLocalPart(a)).toBe(true)
    expect(isValidOpaqueLocalPart(b)).toBe(true)
  })

  it("composes lowercase recipient addresses", () => {
    const addr = composeInboundRecipientAddress("fd" + "a".repeat(40), "INBOUND.EXAMPLE.COM")
    expect(addr).toBe(`fd${"a".repeat(40)}@inbound.example.com`)
  })
})
