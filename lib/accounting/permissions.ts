export type AccountingUser = {
  workspace?: string | null
  permissions?: string[] | null
}

export function accountingUserFromRequest(request: Request): AccountingUser {
  const permissionsHeader = request.headers.get("x-permissions") ?? ""
  const permissions = permissionsHeader
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    workspace: request.headers.get("x-workspace"),
    permissions,
  }
}

export function assertAccountingAccess(user: AccountingUser | null | undefined): void {
  if (!user) {
    throw new Error("Unauthorized")
  }

  if (!user.permissions?.includes("accounting:read")) {
    throw new Error("Forbidden")
  }

  if (user.workspace !== "accounting") {
    throw new Error("Invalid workspace")
  }
}
