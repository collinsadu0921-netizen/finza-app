-- Variant barcodes: enforce uniqueness per tenant (business) and keep business_id in sync for indexing.
--
-- RISK (read before apply):
-- - If two variants in the SAME business already share the same non-empty barcode, this migration FAILS
--   until duplicates are resolved (Finza will raise from the duplicate check block below).
-- - Orphan variants (product_id missing from products) will fail the NOT NULL step — fix data first.
--
-- Safe pattern: backfill business_id from parent product, then unique (business_id, barcode).

-- 0) Fail fast with a clear message if duplicate variant barcodes exist within a business
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO dup_count
  FROM (
    SELECT p.business_id, pv.barcode
    FROM products_variants pv
    INNER JOIN products p ON p.id = pv.product_id
    WHERE pv.barcode IS NOT NULL
      AND btrim(pv.barcode) <> ''
    GROUP BY p.business_id, pv.barcode
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 429: % duplicate variant barcode value(s) within the same business. '
      'Merge or clear duplicate variant barcodes, then re-run.',
      dup_count;
  END IF;
END $$;

-- 1) Denormalized business for indexing / RLS-friendly scoping
ALTER TABLE products_variants
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE CASCADE;

UPDATE products_variants pv
SET business_id = p.business_id
FROM products p
WHERE p.id = pv.product_id
  AND (pv.business_id IS DISTINCT FROM p.business_id);

-- 2) Keep business_id aligned when product_id changes (or on insert)
CREATE OR REPLACE FUNCTION public.products_variants_set_business_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bid uuid;
BEGIN
  SELECT p.business_id
  INTO STRICT bid
  FROM public.products p
  WHERE p.id = NEW.product_id;

  NEW.business_id := bid;
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'products_variants: product % not found', NEW.product_id;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_variants_set_business_id ON public.products_variants;
CREATE TRIGGER trg_products_variants_set_business_id
  BEFORE INSERT OR UPDATE ON public.products_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.products_variants_set_business_id();

COMMENT ON FUNCTION public.products_variants_set_business_id() IS
  'Sets products_variants.business_id from parent products.business_id for POS indexing and barcode uniqueness.';

ALTER TABLE products_variants
  ALTER COLUMN business_id SET NOT NULL;

-- 3) One non-empty barcode per variant SKU line per business (Lightspeed-style shelf uniqueness)
DROP INDEX IF EXISTS idx_products_variants_barcode;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_variants_barcode_business
  ON public.products_variants (business_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

-- Fast POS lookup by scanned value (filtered to business in app)
CREATE INDEX IF NOT EXISTS idx_products_variants_barcode_scan
  ON public.products_variants (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS idx_products_variants_sku_scan
  ON public.products_variants (sku)
  WHERE sku IS NOT NULL AND btrim(sku) <> '';
