import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
  isUserAccountantReadonly: jest.fn(),
}))

import {
  getUserRole,
  isUserAccountantReadonly,
} from "@/lib/userRoles"
import { requireAccountingWriteRole } from "../requireAccountingWriteRole"

describe("requireAccountingWriteRole", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isUserAccountantReadonly as jest.Mock).mockResolvedValue(false)
  })

  it("allows the owner", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue("owner")
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
  })

  it("allows an admin", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue("admin")
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
  })

  it("allows an authorized accountant", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue("accountant")
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toBeNull()
  })

  it("denies a read-only accountant", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue("accountant")
    ;(isUserAccountantReadonly as jest.Mock).mockResolvedValue(true)
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "ACCOUNTING_WRITE_READ_ONLY",
    })
  })

  it("denies staff", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue("staff")
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "ACCOUNTING_WRITE_PERMISSION_DENIED",
    })
  })

  it("denies a non-member/cross-tenant user", async () => {
    ;(getUserRole as jest.Mock).mockResolvedValue(null)
    await expect(
      requireAccountingWriteRole({} as never, "user-1", "biz-1")
    ).resolves.toMatchObject({
      status: 403,
      code: "ACCOUNTING_WRITE_FORBIDDEN",
    })
  })
})
