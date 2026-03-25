-- ============================================================================
-- Migration 388: post_bill_to_ledger + post_bill_payment_to_ledger — FX → home
-- ============================================================================
-- Bills can store document amounts in currency_code with fx_rate (357).
-- Scales journal and inventory amounts by fx_rate when set. Bill payments
-- (document currency) are scaled before posting so AP clears in home currency.
-- ============================================================================

DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_bill_to_ledger(
  p_bill_id          UUID,
  p_entry_type       TEXT DEFAULT NULL,
  p_backfill_reason  TEXT DEFAULT NULL,
  p_backfill_actor   TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  bill_record              RECORD;
  business_id_val          UUID;
  ap_account_id            UUID;
  expense_account_id       UUID;
  landed_account_id        UUID;
  clearing_account_id      UUID;
  wht_account_id           UUID;
  journal_id               UUID;
  tax_lines_jsonb          JSONB;
  tax_line_item            JSONB;
  parsed_tax_lines         JSONB[] := ARRAY[]::JSONB[];
  journal_lines            JSONB;
  tax_account_id           UUID;
  tax_code                 TEXT;
  tax_amount               NUMERIC;
  tax_ledger_side          TEXT;
  tax_ledger_account_code  TEXT;
  ap_account_code          TEXT;
  tax_added_from_jsonb     NUMERIC := 0;
  v_nhil                   NUMERIC;
  v_getfund                NUMERIC;
  v_vat                    NUMERIC;
  v_covid                  NUMERIC;
  v_total_tax              NUMERIC;
  v_wht_applicable         BOOLEAN;
  v_wht_amount             NUMERIC;
  v_ap_credit              NUMERIC;
  -- Import-specific
  v_bill_type              TEXT;
  v_landed_cost            NUMERIC;
  v_clearing_fee           NUMERIC;
  v_landed_account         TEXT;
  -- Per-line allocation (standard bills)
  v_item                   RECORD;
  v_total_line_subtotal    NUMERIC;
  v_line_pre_tax           NUMERIC;
  -- Inventory sync
  v_prev_qty               NUMERIC;
  v_prev_cost              NUMERIC;
  v_new_qty                NUMERIC;
  v_new_avg_cost           NUMERIC;
  v_import_unit_cost       NUMERIC;
  v_apply_fx               BOOLEAN := FALSE;
BEGIN
  -- ── Fetch bill ──────────────────────────────────────────────────────────────
  SELECT
    b.business_id,
    b.total,
    b.subtotal,
    b.total_tax,
    b.nhil,
    b.getfund,
    b.vat,
    b.covid,
    b.bill_number,
    b.issue_date,
    b.tax_lines,
    COALESCE(b.wht_applicable, FALSE)            AS wht_applicable,
    COALESCE(b.wht_amount, 0)                   AS wht_amount,
    COALESCE(b.bill_type, 'standard')           AS bill_type,
    COALESCE(b.cif_value, 0)                   AS cif_value,
    COALESCE(b.import_duty_amount, 0)          AS import_duty_amount,
    COALESCE(b.ecowas_levy, 0)                 AS ecowas_levy,
    COALESCE(b.au_levy, 0)                     AS au_levy,
    COALESCE(b.exim_levy, 0)                   AS exim_levy,
    COALESCE(b.sil_levy, 0)                    AS sil_levy,
    COALESCE(b.examination_fee, 0)             AS examination_fee,
    COALESCE(b.clearing_agent_fee, 0)          AS clearing_agent_fee,
    COALESCE(b.landed_cost_account_code, '5200') AS landed_cost_account_code,
    b.material_id                              AS material_id,
    COALESCE(b.quantity, 1)                    AS quantity,
    b.currency_code                            AS currency_code,
    b.fx_rate                                  AS fx_rate
  INTO bill_record
  FROM bills b
  WHERE b.id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  v_apply_fx := COALESCE(bill_record.fx_rate, 0) > 0 AND bill_record.currency_code IS NOT NULL;

  IF v_apply_fx THEN
    bill_record.subtotal := ROUND(COALESCE(bill_record.subtotal, 0) * bill_record.fx_rate, 2);
    bill_record.total := ROUND(COALESCE(bill_record.total, 0) * bill_record.fx_rate, 2);
    bill_record.total_tax := ROUND(COALESCE(bill_record.total_tax, 0) * bill_record.fx_rate, 2);
    bill_record.nhil := ROUND(COALESCE(bill_record.nhil, 0) * bill_record.fx_rate, 2);
    bill_record.getfund := ROUND(COALESCE(bill_record.getfund, 0) * bill_record.fx_rate, 2);
    bill_record.vat := ROUND(COALESCE(bill_record.vat, 0) * bill_record.fx_rate, 2);
    bill_record.covid := ROUND(COALESCE(bill_record.covid, 0) * bill_record.fx_rate, 2);
    bill_record.wht_amount := ROUND(COALESCE(bill_record.wht_amount, 0) * bill_record.fx_rate, 2);
    bill_record.cif_value := ROUND(COALESCE(bill_record.cif_value, 0) * bill_record.fx_rate, 2);
    bill_record.import_duty_amount := ROUND(COALESCE(bill_record.import_duty_amount, 0) * bill_record.fx_rate, 2);
    bill_record.ecowas_levy := ROUND(COALESCE(bill_record.ecowas_levy, 0) * bill_record.fx_rate, 2);
    bill_record.au_levy := ROUND(COALESCE(bill_record.au_levy, 0) * bill_record.fx_rate, 2);
    bill_record.exim_levy := ROUND(COALESCE(bill_record.exim_levy, 0) * bill_record.fx_rate, 2);
    bill_record.sil_levy := ROUND(COALESCE(bill_record.sil_levy, 0) * bill_record.fx_rate, 2);
    bill_record.examination_fee := ROUND(COALESCE(bill_record.examination_fee, 0) * bill_record.fx_rate, 2);
    bill_record.clearing_agent_fee := ROUND(COALESCE(bill_record.clearing_agent_fee, 0) * bill_record.fx_rate, 2);
  END IF;

  business_id_val  := bill_record.business_id;
  v_wht_applicable := bill_record.wht_applicable;
  v_wht_amount     := bill_record.wht_amount;
  v_bill_type      := bill_record.bill_type;
  v_clearing_fee   := bill_record.clearing_agent_fee;
  v_landed_account := bill_record.landed_cost_account_code;

  -- Net AP credit (applies to both standard and import)
  v_ap_credit := bill_record.total
    - CASE WHEN v_wht_applicable AND v_wht_amount > 0 THEN v_wht_amount ELSE 0 END;

  -- Landed cost for import bills = CIF + duty + all port levies
  v_landed_cost := bill_record.cif_value
    + bill_record.import_duty_amount
    + bill_record.ecowas_levy
    + bill_record.au_levy
    + bill_record.exim_levy
    + bill_record.sil_levy
    + bill_record.examination_fee;

  -- ── Guard: accounting period open ───────────────────────────────────────────
  PERFORM assert_accounting_period_is_open(business_id_val, bill_record.issue_date);

  -- ── Parse tax_lines JSONB ────────────────────────────────────────────────────
  tax_lines_jsonb := bill_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- ── Tax fallback values ──────────────────────────────────────────────────────
  v_nhil    := COALESCE(bill_record.nhil,    0);
  v_getfund := COALESCE(bill_record.getfund, 0);
  v_vat     := COALESCE(bill_record.vat,     0);
  v_covid   := COALESCE(bill_record.covid,   0);
  v_total_tax := COALESCE(bill_record.total_tax, v_nhil + v_getfund + v_vat + v_covid);

  -- ── COA guards ──────────────────────────────────────────────────────────────
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);

  IF v_bill_type = 'import' THEN
    PERFORM assert_account_exists(business_id_val, v_landed_account);
    IF v_clearing_fee > 0 THEN
      PERFORM assert_account_exists(business_id_val, '5220');
    END IF;
  ELSE
    PERFORM assert_account_exists(business_id_val, '5200');
  END IF;

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  IF v_total_tax > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2100');
    IF v_nhil    > 0 THEN PERFORM assert_account_exists(business_id_val, '2110'); END IF;
    IF v_getfund > 0 THEN PERFORM assert_account_exists(business_id_val, '2120'); END IF;
    IF v_covid   > 0 THEN PERFORM assert_account_exists(business_id_val, '2130'); END IF;
  END IF;

  IF v_wht_applicable AND v_wht_amount > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2150');
  END IF;

  -- ── Build journal lines ──────────────────────────────────────────────────────
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');

  IF v_bill_type = 'import' THEN
    -- ── IMPORT BILL ────────────────────────────────────────────────────────────
    landed_account_id := get_account_by_code(business_id_val, v_landed_account);

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  landed_account_id,
        'debit',       v_landed_cost,
        'description', 'Import landed cost (CIF + duty + levies)'
      ),
      jsonb_build_object(
        'account_id',  ap_account_id,
        'credit',      v_ap_credit,
        'description', CASE WHEN v_wht_applicable AND v_wht_amount > 0
                         THEN 'Import bill payable (net of WHT)'
                         ELSE 'Import bill payable'
                       END
      )
    );

    IF v_clearing_fee > 0 THEN
      clearing_account_id := get_account_by_code(business_id_val, '5220');
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  clearing_account_id,
          'debit',       v_clearing_fee,
          'description', 'Clearing & forwarding fee'
        )
      );
    END IF;

  ELSE
    -- ── STANDARD BILL — per-line account allocation ──────────────────────────
    -- Compute total of all line_subtotals for proportional pre-tax allocation
    SELECT COALESCE(SUM(
      CASE WHEN v_apply_fx THEN ROUND(bi.line_subtotal * bill_record.fx_rate, 2) ELSE bi.line_subtotal END
    ), 0)
    INTO v_total_line_subtotal
    FROM bill_items bi
    WHERE bi.bill_id = p_bill_id;

    -- Start with the Cr AP line; Dr lines appended per item below
    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  ap_account_id,
        'credit',      v_ap_credit,
        'description', CASE WHEN v_wht_applicable AND v_wht_amount > 0
                         THEN 'Bill payable (net of WHT)'
                         ELSE 'Bill payable'
                       END
      )
    );

    FOR v_item IN
      SELECT
        bi.description,
        bi.qty,
        CASE WHEN v_apply_fx THEN ROUND(bi.unit_price * bill_record.fx_rate, 2) ELSE bi.unit_price END AS unit_price,
        CASE WHEN v_apply_fx THEN ROUND(bi.line_subtotal * bill_record.fx_rate, 2) ELSE bi.line_subtotal END AS line_subtotal,
        bi.material_id,
        COALESCE(bi.account_id, get_account_by_code(business_id_val, '5200')) AS resolved_account_id
      FROM bill_items bi
      WHERE bi.bill_id = p_bill_id
    LOOP
      -- Proportional pre-tax share for this line
      IF v_total_line_subtotal > 0 THEN
        v_line_pre_tax := ROUND(v_item.line_subtotal / v_total_line_subtotal * bill_record.subtotal, 2);
      ELSE
        v_line_pre_tax := 0;
      END IF;

      IF v_line_pre_tax > 0 THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id',  v_item.resolved_account_id,
            'debit',       v_line_pre_tax,
            'description', COALESCE(v_item.description, 'Supplier bill expense')
          )
        );
      END IF;
    END LOOP;

    -- Edge case: no line items or all zero — fall back to single Dr 5200
    IF v_total_line_subtotal = 0 AND bill_record.subtotal > 0 THEN
      expense_account_id := get_account_by_code(business_id_val, '5200');
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  expense_account_id,
          'debit',       bill_record.subtotal,
          'description', 'Supplier bill expense'
        )
      );
    END IF;
  END IF;

  -- ── WHT Payable (both bill types) ───────────────────────────────────────────
  IF v_wht_applicable AND v_wht_amount > 0 THEN
    wht_account_id := get_account_by_code(business_id_val, '2150');
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id',  wht_account_id,
        'credit',      v_wht_amount,
        'description', 'WHT withheld – payable to GRA'
      )
    );
  END IF;

  -- ── Input tax lines from tax_lines JSONB ────────────────────────────────────
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code                := tax_line_item->>'code';
    tax_amount              := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    IF v_apply_fx THEN
      tax_amount := ROUND(tax_amount * bill_record.fx_rate, 2);
    END IF;
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side         := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);

      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object('account_id', tax_account_id, 'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax')
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object('account_id', tax_account_id, 'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax')
        );
        tax_added_from_jsonb := tax_added_from_jsonb + tax_amount;
      END IF;
    END IF;
  END LOOP;

  -- ── Input tax fallback (column-based) ───────────────────────────────────────
  IF v_total_tax > 0 AND tax_added_from_jsonb <= 0 THEN
    IF v_vat > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', get_account_by_code(business_id_val, '2100'),
          'debit', v_vat, 'description', 'VAT input tax')
      );
    END IF;
    IF v_nhil > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', get_account_by_code(business_id_val, '2110'),
          'debit', v_nhil, 'description', 'NHIL input tax')
      );
    END IF;
    IF v_getfund > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', get_account_by_code(business_id_val, '2120'),
          'debit', v_getfund, 'description', 'GETFund input tax')
      );
    END IF;
    IF v_covid > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', get_account_by_code(business_id_val, '2130'),
          'debit', v_covid, 'description', 'COVID levy (legacy) input tax')
      );
    END IF;
    IF (v_nhil + v_getfund + v_vat + v_covid) <= 0 AND v_total_tax > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', get_account_by_code(business_id_val, '2100'),
          'debit', v_total_tax, 'description', 'Input tax')
      );
    END IF;
  END IF;

  -- ── Post journal entry ───────────────────────────────────────────────────────
  SELECT post_journal_entry(
    business_id_val,
    bill_record.issue_date,
    CASE v_bill_type
      WHEN 'import' THEN 'Import Bill #' || bill_record.bill_number
      ELSE 'Bill #' || bill_record.bill_number
    END,
    'bill',
    p_bill_id,
    journal_lines,
    FALSE, NULL, NULL, NULL,
    p_entry_type, p_backfill_reason, p_backfill_actor,
    NULL, 'system'
  ) INTO journal_id;

  -- ── Inventory sync (runs after JE is posted) ─────────────────────────────────
  IF v_bill_type = 'import' THEN
    -- Import bill: sync bill-level material if linked
    IF bill_record.material_id IS NOT NULL AND bill_record.quantity > 0 THEN
      SELECT quantity_on_hand, average_cost
      INTO v_prev_qty, v_prev_cost
      FROM service_material_inventory
      WHERE id = bill_record.material_id AND business_id = business_id_val;

      IF FOUND THEN
        v_prev_qty         := COALESCE(v_prev_qty, 0);
        v_prev_cost        := COALESCE(v_prev_cost, 0);
        v_new_qty          := v_prev_qty + bill_record.quantity;
        v_import_unit_cost := CASE WHEN bill_record.quantity > 0
                                THEN v_landed_cost / bill_record.quantity
                                ELSE 0 END;
        v_new_avg_cost     := CASE WHEN v_new_qty > 0
                                THEN (v_prev_qty * v_prev_cost + bill_record.quantity * v_import_unit_cost) / v_new_qty
                                ELSE 0 END;

        UPDATE service_material_inventory
        SET quantity_on_hand = v_new_qty,
            average_cost     = v_new_avg_cost,
            updated_at       = NOW()
        WHERE id = bill_record.material_id AND business_id = business_id_val;

        INSERT INTO service_material_movements
          (business_id, material_id, movement_type, quantity, unit_cost, reference_id)
        VALUES
          (business_id_val, bill_record.material_id, 'bill_receipt',
           bill_record.quantity, v_import_unit_cost, p_bill_id);
      END IF;
    END IF;
  ELSE
    -- Standard bill: sync per-line materials
    FOR v_item IN
      SELECT
        bi.qty,
        CASE WHEN v_apply_fx THEN ROUND(bi.unit_price * bill_record.fx_rate, 2) ELSE bi.unit_price END AS unit_price,
        bi.material_id
      FROM bill_items bi
      WHERE bi.bill_id = p_bill_id AND bi.material_id IS NOT NULL AND bi.qty > 0
    LOOP
      SELECT quantity_on_hand, average_cost
      INTO v_prev_qty, v_prev_cost
      FROM service_material_inventory
      WHERE id = v_item.material_id AND business_id = business_id_val;

      IF FOUND THEN
        v_prev_qty     := COALESCE(v_prev_qty, 0);
        v_prev_cost    := COALESCE(v_prev_cost, 0);
        v_new_qty      := v_prev_qty + v_item.qty;
        v_new_avg_cost := CASE WHEN v_new_qty > 0
                            THEN (v_prev_qty * v_prev_cost + v_item.qty * v_item.unit_price) / v_new_qty
                            ELSE 0 END;

        UPDATE service_material_inventory
        SET quantity_on_hand = v_new_qty,
            average_cost     = v_new_avg_cost,
            updated_at       = NOW()
        WHERE id = v_item.material_id AND business_id = business_id_val;

        INSERT INTO service_material_movements
          (business_id, material_id, movement_type, quantity, unit_cost, reference_id)
        VALUES
          (business_id_val, v_item.material_id, 'bill_receipt',
           v_item.qty, v_item.unit_price, p_bill_id);
      END IF;
    END LOOP;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Posts bill to ledger in home currency. When currency_code and fx_rate are set (357), scales bill totals, import components, '
  'line items, tax_lines amounts, and inventory unit costs by fx_rate (rounded). Standard: Dr per-line + Dr Input Tax / Cr AP (± WHT). '
  'Import: Dr Landed + Dr Clearing + Dr Input Tax / Cr AP (± WHT). Balanced.';

-- ============================================================================
-- post_bill_payment_to_ledger: scale payment amount when bill is FX
-- ============================================================================

CREATE OR REPLACE FUNCTION post_bill_payment_to_ledger(p_bill_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
  cash_account_code TEXT;
  bank_account_code TEXT;
  ap_account_code TEXT;
BEGIN
  SELECT
    bp.business_id,
    bp.bill_id,
    bp.amount,
    bp.method,
    bp.date
  INTO payment_record
  FROM bill_payments bp
  WHERE bp.id = p_bill_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill payment not found: %', p_bill_payment_id;
  END IF;

  SELECT id, bill_number, status, currency_code, fx_rate
  INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found for payment: %. Bill ID: %', p_bill_payment_id, payment_record.bill_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF COALESCE(bill_record.fx_rate, 0) > 0 AND bill_record.currency_code IS NOT NULL THEN
    payment_amount := ROUND(payment_amount * bill_record.fx_rate, 2);
  END IF;

  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Bill Payment ID: %', payment_amount, p_bill_payment_id;
  END IF;

  business_id_val := payment_record.business_id;

  IF bill_record.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Cannot post payment for bill %, status=% (must be open).', bill_record.id, bill_record.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type = 'bill'
      AND reference_id = payment_record.bill_id
  ) THEN
    PERFORM post_bill_to_ledger(payment_record.bill_id);
  END IF;

  ap_account_code := get_control_account_code(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');

  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020');

  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020');

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
  END IF;

  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id;
    WHEN 'cheque' THEN asset_account_id := bank_account_id;
    WHEN 'paystack' THEN asset_account_id := bank_account_id;
    ELSE asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Bill Payment ID: %. Cash: %, Bank: %, MoMo: %',
      payment_record.method, business_id_val, p_bill_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ap_account_id,
        'debit', payment_amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'credit', payment_amount,
        'description', 'Payment made'
      )
    ),
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_payment_to_ledger(UUID) IS
  'Posts bill payment to ledger in home currency. When the bill has currency_code and fx_rate, scales the payment amount by fx_rate. '
  'Ensures bill JE exists. posting_source = system.';
