/** @jest-environment node */

import ServiceRouteLoadingSkeleton from "@/components/service/ServiceRouteLoadingSkeleton"

describe("ServiceRouteLoadingSkeleton", () => {
  it("exports a renderable component function", () => {
    expect(typeof ServiceRouteLoadingSkeleton).toBe("function")
  })
})
