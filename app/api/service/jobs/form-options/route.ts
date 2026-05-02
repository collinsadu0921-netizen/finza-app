import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

/**
 * GET /api/service/jobs/form-options
 * Customers + eligible proformas for new/edit project forms.
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const denied = await enforceServiceIndustryMinTier(supabase, user.id, business.id, "professional")
    if (denied) return denied

    const [{ data: customerData, error: custErr }, { data: proformaData, error: profErr }] =
      await Promise.all([
        supabase.from("customers").select("id, name").eq("business_id", business.id).order("name"),
        supabase
          .from("proforma_invoices")
          .select("id, proforma_number, customers(name)")
          .eq("business_id", business.id)
          .in("status", ["sent", "accepted"])
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ])

    if (custErr) {
      return NextResponse.json({ error: custErr.message }, { status: 500 })
    }
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 })
    }

    const proformas = ((proformaData ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string,
      proforma_number: p.proforma_number as string | null,
      customer_name: Array.isArray(p.customers)
        ? (((p.customers as { name?: string }[])[0]?.name ?? null) as string | null)
        : ((p.customers as { name?: string } | null)?.name ?? null),
    }))

    return NextResponse.json({
      customers: customerData ?? [],
      proformas,
    })
  } catch (err: unknown) {
    console.error("GET /api/service/jobs/form-options:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
