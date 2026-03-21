-- Bill balance and status use net payable to supplier (total - WHT when applicable),
-- matching AP posting in post_bill_to_ledger (Cr AP = total - wht_amount).

CREATE OR REPLACE FUNCTION calculate_bill_balance(bill_uuid UUID)
RETURNS NUMERIC AS $$
DECLARE
  bill_total   NUMERIC;
  wht_app      BOOLEAN;
  wht_amt      NUMERIC;
  net_payable  NUMERIC;
  payments_sum NUMERIC := 0;
  balance      NUMERIC;
BEGIN
  SELECT b.total,
         COALESCE(b.wht_applicable, FALSE),
         COALESCE(b.wht_amount, 0)
  INTO bill_total, wht_app, wht_amt
  FROM bills b
  WHERE b.id = bill_uuid
    AND b.deleted_at IS NULL;

  IF bill_total IS NULL THEN
    RETURN 0;
  END IF;

  net_payable := bill_total - CASE WHEN wht_app AND wht_amt > 0 THEN wht_amt ELSE 0 END;
  IF net_payable < 0 THEN
    net_payable := 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO payments_sum
  FROM bill_payments
  WHERE bill_id = bill_uuid
    AND deleted_at IS NULL;

  balance := net_payable - payments_sum;
  RETURN GREATEST(0, balance);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_bill_status()
RETURNS TRIGGER AS $$
DECLARE
  bill_total    NUMERIC;
  wht_app       BOOLEAN;
  wht_amt       NUMERIC;
  net_payable   NUMERIC;
  total_paid    NUMERIC;
  cur_status    TEXT;
  bill_due_date DATE;
  new_balance   NUMERIC;
  new_status    TEXT;
BEGIN
  SELECT b.total,
         b.status,
         b.due_date,
         COALESCE(b.wht_applicable, FALSE),
         COALESCE(b.wht_amount, 0)
  INTO bill_total, cur_status, bill_due_date, wht_app, wht_amt
  FROM bills b
  WHERE b.id = NEW.bill_id;

  net_payable := bill_total - CASE WHEN wht_app AND wht_amt > 0 THEN wht_amt ELSE 0 END;
  IF net_payable < 0 THEN
    net_payable := 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM bill_payments
  WHERE bill_id = NEW.bill_id
    AND deleted_at IS NULL;

  new_balance := net_payable - total_paid;

  IF new_balance <= 0 THEN
    new_status := 'paid';
  ELSIF total_paid > 0 THEN
    new_status := 'partially_paid';
  ELSIF cur_status = 'draft' THEN
    new_status := 'draft';
  ELSE
    new_status := 'open';
  END IF;

  IF new_status != 'paid' AND bill_due_date IS NOT NULL THEN
    IF CURRENT_DATE > bill_due_date THEN
      new_status := 'overdue';
    END IF;
  END IF;

  UPDATE bills
  SET
    status = new_status,
    paid_at = CASE WHEN new_status = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
    updated_at = NOW()
  WHERE id = NEW.bill_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_bill_balance(UUID) IS
  'Outstanding supplier portion: (total - WHT if applicable) minus sum of bill_payments.';
