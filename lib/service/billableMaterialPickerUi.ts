import type { BillableMaterialListItem } from "@/lib/service/materialBillableList"
import type { MenuSelectOption } from "@/components/ui/MenuSelect"

export type BillableMaterialOption = BillableMaterialListItem

export async function fetchBillableMaterials(): Promise<BillableMaterialOption[]> {
  const res = await fetch("/api/service/materials/billable-list")
  const payload = await res.json().catch(() => ({}))
  if (res.ok && Array.isArray(payload.materials)) {
    return payload.materials as BillableMaterialOption[]
  }
  return []
}

export function formatMaterialMenuLabel(
  material: BillableMaterialOption,
  pricePrefix: string
): string {
  const unitPart = material.unit ? ` (${material.unit})` : ""
  const price = Number(material.sellingPrice) || 0
  return `${material.name}${unitPart} — ${pricePrefix}${price.toFixed(2)}`
}

export function buildMaterialMenuOptions(
  materials: BillableMaterialOption[],
  pricePrefix: string,
  savedMaterialLines?: Array<{ material_id?: string | null; description?: string }>
): MenuSelectOption[] {
  const options: MenuSelectOption[] = [
    { value: "", label: "Select material…" },
    ...materials.map((m) => ({
      value: m.id,
      label: formatMaterialMenuLabel(m, pricePrefix),
    })),
  ]

  if (savedMaterialLines) {
    for (const line of savedMaterialLines) {
      const id = line.material_id?.trim()
      if (id && !materials.some((m) => m.id === id)) {
        options.push({
          value: id,
          label: line.description?.trim() || "Material (saved on document)",
        })
      }
    }
  }

  return options
}

export function snapshotFromBillableMaterial(
  material: BillableMaterialOption,
  quantity = 1
): {
  material_id: string
  description: string
  price: number
  quantity: number
} {
  return {
    material_id: material.id,
    description: material.description || material.name,
    price: Number(material.sellingPrice) || 0,
    quantity: quantity || 1,
  }
}
