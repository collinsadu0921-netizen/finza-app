import { describe, expect, it } from "@jest/globals"
import {
  isProtectedBusinessField,
  profileUpdateTouchesProtectedField,
  PROTECTED_BUSINESS_FIELDS,
} from "../protectedBusinessFields"
import { canChangeOtherMembership, canDeleteMembership, canSelfInsertAdminMembership } from "../membershipAccessRules"

describe("protected business fields", () => {
  it("blocks industry and billing fields and allows profile fields", () => {
    expect(isProtectedBusinessField("industry")).toBe(true)
    expect(isProtectedBusinessField("billing_exempt")).toBe(true)
    expect(isProtectedBusinessField("name")).toBe(false)
    expect(profileUpdateTouchesProtectedField({ name: "Shop", phone: "020" })).toBeNull()
    expect(profileUpdateTouchesProtectedField({ industry: "retail" })).toBe("industry")
    expect(PROTECTED_BUSINESS_FIELDS).toEqual(
      expect.arrayContaining(["service_subscription_status", "subscription_grace_until", "trial_ends_at"])
    )
  })
})

describe("membership access rules", () => {
  it("allows an owner to insert only their own admin membership", () => {
    expect(
      canSelfInsertAdminMembership({
        actorUserId: "u1",
        rowUserId: "u1",
        role: "admin",
        ownsBusiness: true,
      })
    ).toBe(true)
    expect(
      canSelfInsertAdminMembership({
        actorUserId: "u1",
        rowUserId: "u2",
        role: "admin",
        ownsBusiness: false,
      })
    ).toBe(false)
    expect(
      canSelfInsertAdminMembership({
        actorUserId: "u1",
        rowUserId: "u1",
        role: "owner",
        ownsBusiness: true,
      })
    ).toBe(false)
  })

  it("denies self-promotion and cross-role escalation", () => {
    expect(
      canChangeOtherMembership({
        actorRole: "cashier",
        actorUserId: "c1",
        targetUserId: "c1",
        previousRole: "cashier",
        nextRole: "admin",
      })
    ).toBe(false)
    expect(
      canChangeOtherMembership({
        actorRole: "admin",
        actorUserId: "a1",
        targetUserId: "a1",
        previousRole: "admin",
        nextRole: "owner",
      })
    ).toBe(false)
    expect(
      canChangeOtherMembership({
        actorRole: "manager",
        actorUserId: "m1",
        targetUserId: "c1",
        previousRole: "cashier",
        nextRole: "admin",
      })
    ).toBe(false)
    expect(
      canChangeOtherMembership({
        actorRole: "owner",
        actorUserId: "o1",
        targetUserId: "c1",
        previousRole: "cashier",
        nextRole: "manager",
      })
    ).toBe(true)
  })

  it("denies deleting yourself, the owner, or another tenant's implied membership", () => {
    expect(
      canDeleteMembership({
        actorRole: "admin",
        actorUserId: "a1",
        targetUserId: "a1",
        targetRole: "admin",
        businessOwnerId: "o1",
      })
    ).toBe(false)
    expect(
      canDeleteMembership({
        actorRole: "owner",
        actorUserId: "o1",
        targetUserId: "o1",
        targetRole: "admin",
        businessOwnerId: "o1",
      })
    ).toBe(false)
    expect(
      canDeleteMembership({
        actorRole: "cashier",
        actorUserId: "c1",
        targetUserId: "c2",
        targetRole: "cashier",
        businessOwnerId: "o1",
      })
    ).toBe(false)
  })
})
