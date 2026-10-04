import fs from "fs"
import path from "path"
import { retailInvitationPublicError } from "../retailInvitationAcceptError"

const migration = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "585_retail_invite_profile_and_split_payment.sql"),
  "utf8"
)

function section(start: string, end: string): string {
  const from = migration.indexOf(start)
  const to = migration.indexOf(end, from)
  return migration.slice(from, to)
}

describe("accept_retail_invitation profile provisioning", () => {
  const beforeBusiness = section("IF v_inv.email_normalized", "INSERT INTO public.businesses")

  it("creates public.users for an invited auth user before the retail business", () => {
    const usersAt = migration.indexOf("INSERT INTO public.users")
    const businessAt = migration.indexOf("INSERT INTO public.businesses")
    expect(usersAt).toBeGreaterThan(-1)
    expect(usersAt).toBeLessThan(businessAt)
    expect(migration).toContain("ON CONFLICT (id) DO NOTHING")
    expect(migration).toContain("VALUES (p_user_id, v_email, '')")
  })

  it("checks the invitation email before inserting a profile", () => {
    expect(beforeBusiness).toContain("retail_invitation_email_mismatch")
    expect(beforeBusiness.indexOf("retail_invitation_email_mismatch")).toBeLessThan(
      beforeBusiness.indexOf("INSERT INTO public.users")
    )
  })

  it("rejects expired and non-pending invitations before creating a user or business", () => {
    const usersAt = migration.indexOf("INSERT INTO public.users")
    const prelude = migration.slice(0, usersAt)
    expect(prelude).toContain("retail_invitation_expired")
    expect(prelude).toContain("retail_invitation_not_pending")
    expect(prelude.indexOf("retail_invitation_expired")).toBeLessThan(usersAt)
    expect(prelude.indexOf("retail_invitation_not_pending")).toBeLessThan(usersAt)
  })

  it("does not insert a second business when the invitation is no longer pending", () => {
    expect(migration).toContain("AND status = 'pending'")
    expect(migration).toContain("retail_invitation_race")
    expect(migration.match(/INSERT INTO public\.businesses/g)).toHaveLength(1)
  })

  it("allows split as a sales payment method without dropping cash, momo, card, or bank", () => {
    expect(migration).toContain("sales_payment_method_check")
    expect(migration).toContain("'split'")
    expect(migration).toContain("'cash'")
    expect(migration).toContain("'momo'")
    expect(migration).toContain("'card'")
    expect(migration).toContain("'bank'")
    expect(migration).not.toContain("429")
    expect(migration).not.toContain("430")
  })
})

describe("retail invitation public errors", () => {
  it("keeps wrong-email, expired, and revoked responses specific", () => {
    expect(retailInvitationPublicError("retail_invitation_email_mismatch").status).toBe(403)
    expect(retailInvitationPublicError("retail_invitation_expired").status).toBe(410)
    expect(retailInvitationPublicError("retail_invitation_not_pending").status).toBe(409)
    expect(retailInvitationPublicError("retail_invitation_invalid").status).toBe(400)
    expect(retailInvitationPublicError("retail_invitation_invalid").error).toBe(
      "This invitation link is not valid."
    )
  })

  it("does not describe a missing public.users row as an invalid link", () => {
    const fk =
      'insert or update on table "businesses" violates foreign key constraint "businesses_owner_id_fkey"'
    const mapped = retailInvitationPublicError(fk)
    expect(mapped.status).toBe(500)
    expect(mapped.error).not.toContain("violates")
    expect(mapped.error).not.toContain("businesses_owner_id_fkey")
    expect(retailInvitationPublicError("retail_invitation_profile_setup").status).toBe(500)
  })
})
