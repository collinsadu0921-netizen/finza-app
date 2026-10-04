import fs from "fs"
import path from "path"

const migrationsDir = path.join(__dirname, "..", "..", "..", "supabase", "migrations")
const rls = fs.readFileSync(path.join(migrationsDir, "583_retail_tenant_rls_hardening.sql"), "utf8")
const idempotency = fs.readFileSync(path.join(migrationsDir, "584_retail_online_sale_client_id.sql"), "utf8")
const engine = fs.readFileSync(
  path.join(__dirname, "..", "..", "sales", "runRetailSaleCreationEngine.server.ts"),
  "utf8"
)

describe("583 retail tenant RLS", () => {
  it.each(["products_variants", "receipt_settings", "cashier_sessions", "parked_sales"])(
    "enables RLS and tenant checks on %s",
    (table) => {
      expect(rls).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(rls).toContain(`${table}_tenant_select`)
      expect(rls).toContain(`${table}_tenant_insert`)
      expect(rls).toContain(`${table}_tenant_update`)
      expect(rls).toContain(`${table}_tenant_delete`)
    }
  )

  it("does not leave an open USING (true) policy", () => {
    expect(rls).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(rls).toContain("finza_user_can_access_business(business_id)")
    expect(rls).toContain("WITH CHECK (public.finza_user_can_access_business(business_id))")
    expect(rls).toContain("p.id = products_variants.product_id")
    expect(rls).toContain("finza_user_can_access_business(p.business_id)")
  })
})

describe("584 online sale client id", () => {
  it("adds a business and register scoped unique index", () => {
    expect(idempotency).toContain("ADD COLUMN IF NOT EXISTS client_sale_id text")
    expect(idempotency).toContain("sales_online_client_sale_id_uidx")
    expect(idempotency).toContain("(business_id, register_id, client_sale_id)")
    expect(idempotency).toContain("WHERE client_sale_id IS NOT NULL AND register_id IS NOT NULL")
  })
})

describe("sale engine persistence", () => {
  it("stores the reference and returns the existing sale on a duplicate client id", () => {
    expect(engine).toContain("saleData.payment_reference = salePaymentReferenceFromLines")
    expect(engine).toContain("saleData.client_sale_id = clientSaleId")
    expect(engine).toContain("isUniqueViolation(saleError)")
    expect(engine).toContain("idempotent: true")
  })
})
