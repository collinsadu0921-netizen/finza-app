-- ============================================================================
-- Migration 548: Supplier-bill material lines debit 1450 + inventory cost alignment
-- ============================================================================
-- Forward-only. Does not repair historical bills or movements.
--
-- Changes vs 390:
-- 1) Fail closed if bills.discount_amount exists and is non-zero (unsupported header discount)
-- 2) Early-return if bill JE already exists (no duplicate journal / stock)
-- 3) Standard bills with subtotal but no bill_items refuse posting
-- 4) material_id IS NOT NULL → Dr accounts 1450 via get_account_by_code
-- 5) Ordinary lines → CoA account_id mapped to accounts by code, else 5200 fallback
-- 6) Inventory receipt value = final post-correction material 1450 debits per material
-- 7) Idempotent bill_receipt (skip if exists) + unique index after RO duplicate precheck
-- 8) Exact invariant: Σ Dr 1450 = Σ receipt value = Σ inventory value increase (home currency, 2dp)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Read-only duplicate precheck (no delete / merge / repair)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_count INTEGER;
  v_sample TEXT;
BEGIN
  SELECT COUNT(*)::INTEGER INTO v_dup_count
  FROM (
    SELECT reference_id, material_id
    FROM public.service_material_movements
    WHERE movement_type = 'bill_receipt'
      AND reference_id IS NOT NULL
    GROUP BY reference_id, material_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_dup_count > 0 THEN
    SELECT string_agg(reference_id::text || '/' || material_id::text, ', ')
    INTO v_sample
    FROM (
      SELECT reference_id, material_id
      FROM public.service_material_movements
      WHERE movement_type = 'bill_receipt'
        AND reference_id IS NOT NULL
      GROUP BY reference_id, material_id
      HAVING COUNT(*) > 1
      LIMIT 5
    ) s;

    RAISE EXCEPTION
      'Migration 548 aborted: % duplicate bill_receipt (reference_id, material_id) group(s) exist. Sample: %. Resolve manually before re-running. No data was modified by this migration.',
      v_dup_count,
      COALESCE(v_sample, '');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_material_movements_bill_receipt
  ON public.service_material_movements (reference_id, material_id)
  WHERE movement_type = 'bill_receipt'
    AND reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) post_bill_to_ledger
-- ---------------------------------------------------------------------------
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
  v_tax_parts_sum          NUMERIC;
  v_wht_applicable         BOOLEAN;
  v_wht_amount             NUMERIC;
  v_ap_credit              NUMERIC;
  v_bill_type              TEXT;
  v_landed_cost            NUMERIC;
  v_clearing_fee           NUMERIC;
  v_landed_account         TEXT;
  v_item                   RECORD;
  v_total_line_subtotal    NUMERIC;
  v_line_pre_tax           NUMERIC;
  v_cum_pre_tax            NUMERIC := 0;
  v_prev_qty               NUMERIC;
  v_prev_cost              NUMERIC;
  v_new_qty                NUMERIC;
  v_new_avg_cost           NUMERIC;
  v_import_unit_cost       NUMERIC;
  v_apply_fx               BOOLEAN := FALSE;
  v_total_debit_lines      NUMERIC := 0;
  v_total_credit_lines     NUMERIC := 0;
  v_balance_delta          NUMERIC := 0;
  v_last_tax_debit_idx     INTEGER := NULL;
  v_last_expense_debit_idx INTEGER := NULL;
  v_candidate_idx          INTEGER := NULL;
  v_line_account_id        UUID;
  v_tax_account_ids        UUID[] := ARRAY[]::UUID[];
  v_tax_account_code       TEXT;
  v_line_json              JSONB;
  v_line_debit             NUMERIC;
  v_line_credit            NUMERIC;
  v_new_debit              NUMERIC;
  v_line_rec               RECORD;
  v_bill_json              JSONB;
  v_resolved_account_id    UUID;
  v_material_agg           JSONB := '{}'::jsonb;
  v_mat_debit_lines        JSONB := '[]'::jsonb;
  v_mat_track              JSONB;
  v_mat_key                TEXT;
  v_mat_prev               JSONB;
  v_mat_id                 UUID;
  v_agg_qty                NUMERIC;
  v_agg_value              NUMERIC;
  v_unit_cost              NUMERIC;
  v_has_material_lines     BOOLEAN := FALSE;
  v_1450_account_id        UUID;
  v_sum_1450               NUMERIC := 0;
  v_sum_receipt_value      NUMERIC := 0;
  v_je_line_idx            INTEGER;
BEGIN
  -- Idempotent: existing bill JE → return without touching stock
  SELECT je.id INTO journal_id
  FROM public.journal_entries je
  WHERE je.reference_type = 'bill'
    AND je.reference_id = p_bill_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT to_jsonb(b.*) INTO v_bill_json
  FROM public.bills b
  WHERE b.id = p_bill_id;

  IF v_bill_json IS NULL THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  IF (v_bill_json ? 'discount_amount')
     AND COALESCE((v_bill_json->>'discount_amount')::NUMERIC, 0) <> 0 THEN
    RAISE EXCEPTION
      'unsupported_bill_level_discount: bills.discount_amount is not supported; use line-level discount_amount on bill_items';
  END IF;

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
    b.fx_rate                                  AS fx_rate,
    b.home_currency_total                      AS home_currency_total
  INTO bill_record
  FROM public.bills b
  WHERE b.id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  v_apply_fx := COALESCE(bill_record.fx_rate, 0) > 0 AND bill_record.currency_code IS NOT NULL;

  IF v_apply_fx THEN
    bill_record.subtotal := ROUND(COALESCE(bill_record.subtotal, 0) * bill_record.fx_rate, 2);
    bill_record.total := COALESCE(
      bill_record.home_currency_total,
      ROUND(COALESCE(bill_record.total, 0) * bill_record.fx_rate, 2)
    );
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

  v_ap_credit := bill_record.total
    - CASE WHEN v_wht_applicable AND v_wht_amount > 0 THEN v_wht_amount ELSE 0 END;

  v_landed_cost := bill_record.cif_value
    + bill_record.import_duty_amount
    + bill_record.ecowas_levy
    + bill_record.au_levy
    + bill_record.exim_levy
    + bill_record.sil_levy
    + bill_record.examination_fee;

  PERFORM assert_accounting_period_is_open(business_id_val, bill_record.issue_date);

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

  v_nhil    := COALESCE(bill_record.nhil,    0);
  v_getfund := COALESCE(bill_record.getfund, 0);
  v_vat     := COALESCE(bill_record.vat,     0);
  v_covid   := COALESCE(bill_record.covid,   0);
  v_total_tax := COALESCE(bill_record.total_tax, v_nhil + v_getfund + v_vat + v_covid);

  v_tax_parts_sum := v_nhil + v_getfund + v_vat + v_covid;
  IF v_total_tax > 0 AND v_tax_parts_sum IS DISTINCT FROM v_total_tax THEN
    v_vat := v_vat + (v_total_tax - v_tax_parts_sum);
  END IF;

  IF v_apply_fx AND v_bill_type = 'standard' THEN
    bill_record.subtotal := ROUND(bill_record.total - v_total_tax, 2);
    IF bill_record.subtotal < 0 THEN
      bill_record.subtotal := 0;
    END IF;
  END IF;

  IF v_bill_type = 'import' AND v_apply_fx THEN
    v_landed_cost := bill_record.total - v_clearing_fee - v_total_tax;
    IF v_landed_cost < 0 THEN
      v_landed_cost := 0;
    END IF;
  END IF;

  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);

  IF v_bill_type = 'import' THEN
    PERFORM assert_account_exists(business_id_val, v_landed_account);
    IF v_clearing_fee > 0 THEN
      PERFORM assert_account_exists(business_id_val, '5220');
    END IF;
  ELSE
    PERFORM assert_account_exists(business_id_val, '5200');
    SELECT EXISTS (
      SELECT 1 FROM public.bill_items bi
      WHERE bi.bill_id = p_bill_id AND bi.material_id IS NOT NULL
    ) INTO v_has_material_lines;
    IF v_has_material_lines THEN
      PERFORM assert_account_exists(business_id_val, '1450');
    END IF;
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

  ap_account_id := get_account_by_control_key(business_id_val, 'AP');

  IF v_bill_type = 'import' THEN
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
    SELECT COALESCE(SUM(
      CASE WHEN v_apply_fx THEN ROUND(bi.line_subtotal * bill_record.fx_rate, 2) ELSE bi.line_subtotal END
    ), 0)
    INTO v_total_line_subtotal
    FROM public.bill_items bi
    WHERE bi.bill_id = p_bill_id;

    IF v_total_line_subtotal = 0 AND COALESCE(bill_record.subtotal, 0) > 0 THEN
      RAISE EXCEPTION
        'Bill % has subtotal but no bill_items; refuse posting until lines exist',
        p_bill_id;
    END IF;

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

    v_cum_pre_tax := 0;

    FOR v_item IN
      SELECT
        bi.id,
        bi.description,
        bi.qty,
        CASE WHEN v_apply_fx THEN ROUND(bi.unit_price * bill_record.fx_rate, 2) ELSE bi.unit_price END AS unit_price,
        CASE WHEN v_apply_fx THEN ROUND(bi.line_subtotal * bill_record.fx_rate, 2) ELSE bi.line_subtotal END AS line_subtotal,
        bi.material_id,
        bi.account_id,
        ROW_NUMBER() OVER (ORDER BY bi.created_at NULLS LAST, bi.id) AS _rn,
        COUNT(*) OVER () AS _cnt
      FROM public.bill_items bi
      WHERE bi.bill_id = p_bill_id
    LOOP
      IF v_total_line_subtotal > 0 AND bill_record.subtotal > 0 THEN
        IF v_item._rn < v_item._cnt THEN
          v_line_pre_tax := ROUND(
            v_item.line_subtotal / v_total_line_subtotal * bill_record.subtotal,
            2
          );
          v_cum_pre_tax := v_cum_pre_tax + v_line_pre_tax;
        ELSE
          v_line_pre_tax := bill_record.subtotal - v_cum_pre_tax;
        END IF;
      ELSE
        v_line_pre_tax := 0;
      END IF;

      IF v_item.material_id IS NOT NULL THEN
        v_resolved_account_id := get_account_by_code(business_id_val, '1450');
        IF v_resolved_account_id IS NULL THEN
          RAISE EXCEPTION
            'material_inventory_account_missing: business % has no accounts.code 1450; refusing to post material bill % to expense',
            business_id_val,
            p_bill_id;
        END IF;
      ELSE
        SELECT a.id
        INTO v_resolved_account_id
        FROM public.chart_of_accounts c
        JOIN public.accounts a
          ON a.business_id = business_id_val
         AND a.code = c.account_code
         AND a.deleted_at IS NULL
        WHERE c.id = v_item.account_id
          AND c.business_id = business_id_val
        LIMIT 1;

        IF v_resolved_account_id IS NULL THEN
          v_resolved_account_id := get_account_by_code(business_id_val, '5200');
        END IF;
      END IF;

      IF v_line_pre_tax > 0 THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id',  v_resolved_account_id,
            'debit',       v_line_pre_tax,
            'description', COALESCE(
              v_item.description,
              CASE WHEN v_item.material_id IS NOT NULL
                THEN 'Service materials inventory'
                ELSE 'Supplier bill expense'
              END
            )
          )
        );

        -- Track material debit lines; final values aggregated after 0.01 correction
        IF v_item.material_id IS NOT NULL AND COALESCE(v_item.qty, 0) > 0 THEN
          v_je_line_idx := jsonb_array_length(journal_lines) - 1;
          v_mat_debit_lines := v_mat_debit_lines || jsonb_build_array(
            jsonb_build_object(
              'idx', v_je_line_idx,
              'material_id', v_item.material_id,
              'qty', v_item.qty
            )
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

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

  FOR v_tax_account_code IN
    SELECT unnest(ARRAY['2100','2110','2120','2130'])
  LOOP
    tax_account_id := get_account_by_code(business_id_val, v_tax_account_code);
    IF tax_account_id IS NOT NULL THEN
      v_tax_account_ids := array_append(v_tax_account_ids, tax_account_id);
    END IF;
  END LOOP;
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      IF tax_account_id IS NOT NULL AND NOT (tax_account_id = ANY(v_tax_account_ids)) THEN
        v_tax_account_ids := array_append(v_tax_account_ids, tax_account_id);
      END IF;
    END IF;
  END LOOP;

  FOR v_line_rec IN
    SELECT value AS line_value, (ordinality - 1) AS idx
    FROM jsonb_array_elements(journal_lines) WITH ORDINALITY
  LOOP
    v_line_json := v_line_rec.line_value;
    v_line_account_id := NULLIF(v_line_json->>'account_id','')::UUID;
    v_line_debit := COALESCE((v_line_json->>'debit')::NUMERIC, 0);
    v_line_credit := COALESCE((v_line_json->>'credit')::NUMERIC, 0);

    v_total_debit_lines := v_total_debit_lines + v_line_debit;
    v_total_credit_lines := v_total_credit_lines + v_line_credit;

    IF v_line_debit > 0 THEN
      IF v_line_account_id IS NOT NULL AND v_line_account_id = ANY(v_tax_account_ids) THEN
        v_last_tax_debit_idx := v_line_rec.idx;
      ELSIF v_line_account_id IS DISTINCT FROM ap_account_id THEN
        v_last_expense_debit_idx := v_line_rec.idx;
      END IF;
    END IF;
  END LOOP;

  v_balance_delta := ROUND(v_total_credit_lines - v_total_debit_lines, 2);

  IF ABS(v_balance_delta) = 0.01 THEN
    v_candidate_idx := COALESCE(v_last_tax_debit_idx, v_last_expense_debit_idx);
    IF v_candidate_idx IS NULL THEN
      RAISE EXCEPTION
        'Bill posting 0.01 drift detected but no eligible debit line found for deterministic correction. Bill ID: %, Debits: %, Credits: %',
        p_bill_id, v_total_debit_lines, v_total_credit_lines;
    END IF;

    v_line_json := journal_lines -> v_candidate_idx;
    v_line_debit := COALESCE((v_line_json->>'debit')::NUMERIC, 0);
    v_new_debit := ROUND(v_line_debit + v_balance_delta, 2);

    IF v_new_debit <= 0 THEN
      RAISE EXCEPTION
        'Bill posting correction would produce non-positive debit. Bill ID: %, line_idx: %, old_debit: %, delta: %',
        p_bill_id, v_candidate_idx, v_line_debit, v_balance_delta;
    END IF;

    journal_lines := jsonb_set(
      journal_lines,
      ARRAY[v_candidate_idx::TEXT, 'debit'],
      to_jsonb(v_new_debit),
      FALSE
    );
  ELSIF ABS(v_balance_delta) > 0.01 THEN
    RAISE EXCEPTION
      'Bill journal assembly unbalanced before posting. Bill ID: %, Debits: %, Credits: %, Delta: %',
      p_bill_id, ROUND(v_total_debit_lines, 2), ROUND(v_total_credit_lines, 2), v_balance_delta;
  END IF;

  -- Rebuild material aggregation from FINAL journal debits (after any 0.01 correction)
  -- so Dr 1450, receipt value, and inventory-value increase stay exactly aligned.
  IF v_bill_type <> 'import' THEN
    v_material_agg := '{}'::jsonb;
    v_1450_account_id := get_account_by_code(business_id_val, '1450');

    FOR v_line_rec IN
      SELECT value AS track
      FROM jsonb_array_elements(v_mat_debit_lines)
    LOOP
      v_mat_track := v_line_rec.track;
      v_je_line_idx := (v_mat_track->>'idx')::INTEGER;
      v_mat_id := (v_mat_track->>'material_id')::UUID;
      v_agg_qty := COALESCE((v_mat_track->>'qty')::NUMERIC, 0);
      v_line_json := journal_lines -> v_je_line_idx;
      v_line_account_id := NULLIF(v_line_json->>'account_id', '')::UUID;
      v_line_debit := ROUND(COALESCE((v_line_json->>'debit')::NUMERIC, 0), 2);

      IF v_1450_account_id IS NULL
         OR v_line_account_id IS DISTINCT FROM v_1450_account_id
         OR v_agg_qty <= 0
         OR v_line_debit <= 0 THEN
        CONTINUE;
      END IF;

      v_mat_key := v_mat_id::TEXT;
      v_mat_prev := v_material_agg -> v_mat_key;
      IF v_mat_prev IS NULL THEN
        v_material_agg := v_material_agg || jsonb_build_object(
          v_mat_key,
          jsonb_build_object('qty', v_agg_qty, 'value', v_line_debit)
        );
      ELSE
        v_material_agg := jsonb_set(
          v_material_agg,
          ARRAY[v_mat_key],
          jsonb_build_object(
            'qty', (v_mat_prev->>'qty')::NUMERIC + v_agg_qty,
            'value', ROUND((v_mat_prev->>'value')::NUMERIC + v_line_debit, 2)
          ),
          TRUE
        );
      END IF;
    END LOOP;

    v_sum_1450 := 0;
    v_sum_receipt_value := 0;

    IF v_1450_account_id IS NOT NULL THEN
      FOR v_line_rec IN
        SELECT value AS line_value
        FROM jsonb_array_elements(journal_lines)
      LOOP
        v_line_json := v_line_rec.line_value;
        IF NULLIF(v_line_json->>'account_id', '')::UUID IS NOT DISTINCT FROM v_1450_account_id THEN
          v_sum_1450 := v_sum_1450 + COALESCE((v_line_json->>'debit')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;

    FOR v_line_rec IN
      SELECT value AS agg_value
      FROM jsonb_each(v_material_agg)
    LOOP
      v_sum_receipt_value := v_sum_receipt_value
        + COALESCE((v_line_rec.agg_value->>'value')::NUMERIC, 0);
    END LOOP;

    v_sum_1450 := ROUND(v_sum_1450, 2);
    v_sum_receipt_value := ROUND(v_sum_receipt_value, 2);

    IF v_sum_1450 IS DISTINCT FROM v_sum_receipt_value THEN
      RAISE EXCEPTION
        'material_inventory_value_mismatch: bill % Dr1450=% receipt_value=% (must be exact at 0.01)',
        p_bill_id, v_sum_1450, v_sum_receipt_value;
    END IF;
  END IF;

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

  IF v_bill_type = 'import' THEN
    IF bill_record.material_id IS NOT NULL AND bill_record.quantity > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.service_material_movements
        WHERE movement_type = 'bill_receipt'
          AND reference_id = p_bill_id
          AND material_id = bill_record.material_id
      ) THEN
        SELECT quantity_on_hand, average_cost
        INTO v_prev_qty, v_prev_cost
        FROM public.service_material_inventory
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

          UPDATE public.service_material_inventory
          SET quantity_on_hand = v_new_qty,
              average_cost     = v_new_avg_cost,
              updated_at       = NOW()
          WHERE id = bill_record.material_id AND business_id = business_id_val;

          INSERT INTO public.service_material_movements
            (business_id, material_id, movement_type, quantity, unit_cost, reference_id)
          VALUES
            (business_id_val, bill_record.material_id, 'bill_receipt',
             bill_record.quantity, v_import_unit_cost, p_bill_id);
        END IF;
      END IF;
    END IF;
  ELSE
    FOR v_line_rec IN
      SELECT key, value FROM jsonb_each(v_material_agg)
    LOOP
      v_mat_id := v_line_rec.key::UUID;
      v_agg_qty := COALESCE((v_line_rec.value->>'qty')::NUMERIC, 0);
      v_agg_value := COALESCE((v_line_rec.value->>'value')::NUMERIC, 0);

      IF v_agg_qty <= 0 OR v_agg_value <= 0 THEN
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.service_material_movements
        WHERE movement_type = 'bill_receipt'
          AND reference_id = p_bill_id
          AND material_id = v_mat_id
      ) THEN
        CONTINUE;
      END IF;

      SELECT quantity_on_hand, average_cost
      INTO v_prev_qty, v_prev_cost
      FROM public.service_material_inventory
      WHERE id = v_mat_id AND business_id = business_id_val;

      IF FOUND THEN
        v_prev_qty  := COALESCE(v_prev_qty, 0);
        v_prev_cost := COALESCE(v_prev_cost, 0);
        v_new_qty   := v_prev_qty + v_agg_qty;
        v_unit_cost := ROUND(v_agg_value / v_agg_qty, 6);
        v_new_avg_cost := CASE WHEN v_new_qty > 0
                            THEN (v_prev_qty * v_prev_cost + v_agg_value) / v_new_qty
                            ELSE 0 END;

        UPDATE public.service_material_inventory
        SET quantity_on_hand = v_new_qty,
            average_cost     = v_new_avg_cost,
            updated_at       = NOW()
        WHERE id = v_mat_id AND business_id = business_id_val;

        INSERT INTO public.service_material_movements
          (business_id, material_id, movement_type, quantity, unit_cost, reference_id)
        VALUES
          (business_id_val, v_mat_id, 'bill_receipt',
           v_agg_qty, v_unit_cost, p_bill_id);
      END IF;
    END LOOP;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Posts bill to ledger in home currency. Material lines Dr 1450; ordinary lines Dr selected expense or 5200. '
  'Inventory receipt value equals final material 1450 debits after any 0.01 balance correction. '
  'Exact invariant: Σ Dr1450 = Σ receipt value = Σ inventory value increase. FX/VAT/WHT/AP preserved. '
  'Idempotent JE + bill_receipt. Rejects unsupported bill-level discount_amount.';
