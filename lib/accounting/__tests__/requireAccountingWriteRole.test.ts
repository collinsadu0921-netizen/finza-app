import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))

import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { requireAccountingWriteRole } from "../requireAccountingWriteRole"

function authority(
  authorized: boolean,
  authority_source?: "owner" | "employee" | "accountant" | "report_viewer"
) {
  return {
    authorized,
    businessId: "biz-1",
    ...(authority_source ? { authority_source } : {}),
  }
}

describe("requireAccountingWriteRole", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("allows the owner", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(true, "owner")
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
    expect(checkAccountingAuthority).toHaveBeenCalledWith(
      {},
      "user-1",
      "biz-1",
      "write"
    )
  })

  it("allows an admin/employee", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(true, "employee")
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
  })

  it("allows an authorized accountant", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(true, "accountant")
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
  })

  it("denies a read-only accountant", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(false)
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "INSUFFICIENT_AUTHORITY",
    })
  })

  it("denies staff without accounting authority", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(false)
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "INSUFFICIENT_AUTHORITY",
    })
  })

  it("denies a non-member/cross-tenant user", async () => {
    ;(checkAccountingAuthority as jest.Mock).mockResolvedValue(
      authority(false)
    )
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "INSUFFICIENT_AUTHORITY",
    })
  })
})
