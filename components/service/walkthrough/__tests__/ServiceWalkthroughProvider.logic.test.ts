import { describe, expect, it } from "@jest/globals"
import {
  shouldSuppressTourFromProgress,
  withSavedTourProgress,
} from "../serviceWalkthroughProgressLogic"

describe("ServiceWalkthroughProvider logic helpers", () => {
  it("does not suppress when no progress row exists", () => {
    expect(shouldSuppressTourFromProgress(undefined, 1)).toBe(false)
  })

  it("suppresses when completed with matching version", () => {
    expect(
      shouldSuppressTourFromProgress(
        { tour_key: "service.dashboard", tour_version: 1, status: "completed" },
        1
      )
    ).toBe(true)
  })

  it("suppresses when skipped with matching version", () => {
    expect(
      shouldSuppressTourFromProgress(
        { tour_key: "service.dashboard", tour_version: 1, status: "skipped" },
        1
      )
    ).toBe(true)
  })

  it("does not suppress when stored version is older than tour version", () => {
    expect(
      shouldSuppressTourFromProgress(
        { tour_key: "service.dashboard", tour_version: 1, status: "completed" },
        2
      )
    ).toBe(false)
  })

  it("skip save updates local progress map immediately", () => {
    const next = withSavedTourProgress(new Map(), {
      tour_key: "service.dashboard",
      tour_version: 1,
      status: "skipped",
    })
    expect(next.get("service.dashboard")).toEqual({
      tour_key: "service.dashboard",
      tour_version: 1,
      status: "skipped",
    })
  })

  it("done save updates local progress map immediately", () => {
    const next = withSavedTourProgress(new Map(), {
      tour_key: "service.dashboard",
      tour_version: 1,
      status: "completed",
    })
    expect(next.get("service.dashboard")).toEqual({
      tour_key: "service.dashboard",
      tour_version: 1,
      status: "completed",
    })
  })
})
