# Retail barcode update

## Summary

- Barcode checkout is more reliable on **desktop** and **tablet** (main scan/search field, autofocus when safe, clearer copy).
- **Exact** scan lookup (after **Enter**) supports, in order:
  1. **Variant barcode** (`products_variants.barcode`)
  2. **Product barcode** for **non-variant** products only (`products.barcode` when the product has no variants)
  3. **Variant SKU** (`products_variants.sku`), excluding variants already matched by variant barcode
- **Ambiguous** matches (multiple rows) show a **picker** (`BarcodeMatchSelector`).
- **Variant barcodes** are enforced **unique per business** at the database level (migration `429_products_variants_business_id_barcode_unique.sql`).

## Important (operations & training)

For products **with variants**, the scannable code must be stored on **each variant** (variant **barcode** or variant **SKU**). The **parent** product barcode is **not** used for checkout on variant products—cashiers should rely on per-variant codes on labels and in the catalog.

## Retail POS camera scanning (supported phones & tablets)

- Tap **Camera** from the **Sell** screen.
- Scan a barcode with the device camera.
- Finza uses the **same lookup logic** as barcode entry in the search field (including hardware-style resolution).
- **Hardware scanners** and **manual entry** still work as before.

### Notes

- Camera scanning requires **HTTPS** or **localhost**.
- **Browser support varies**; unsupported devices can still use the search box or a USB/Bluetooth scanner.
- Camera scanning is available on **Retail POS** (`/retail/pos`), not the legacy dashboard POS screen.

## Camera scan — technical (Phase 2)

- Control lives next to the main search field in `RetailPosPage.tsx`.
- Uses **`BarcodeDetector`** when the browser exposes it; otherwise **`@zxing/browser`** decodes from the same `<video>` stream.
- Detected text is passed to the **same** `handleBarcodeScan` path as typing + Enter (no duplicate rules).
- Camera stops on close, successful read, or unmount; duplicate reads of the same value are ignored for ~1.8s.

## Technical references

- Retail POS: `components/retail/pos/RetailPosPage.tsx` (`handleBarcodeScan`, focus helpers, `BarcodeMatchSelector` wiring).
- Camera modal: `components/retail/pos/RetailPosCameraBarcodeModal.tsx`.
- Legacy/dashboard POS (aligned): `app/(dashboard)/pos/page.impl.tsx`.
- Schema: `supabase/migrations/429_products_variants_business_id_barcode_unique.sql`.
