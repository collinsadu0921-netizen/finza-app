import { NextResponse } from "next/server"
import { TRIAL_EXPIRED_READ_ONLY_MESSAGE } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export function mockLockedFinancialWriteResponse() {
  return NextResponse.json(
    {
      error: TRIAL_EXPIRED_READ_ONLY_MESSAGE,
      code: "TRIAL_EXPIRED_READ_ONLY",
    },
    { status: 403 }
  )
}

export function mockSupabaseAuthUser() {
  return {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
  }
}
