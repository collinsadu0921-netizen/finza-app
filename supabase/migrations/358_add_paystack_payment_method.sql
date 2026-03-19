-- Add 'paystack' as an allowed payment method
-- Paystack is a payment gateway widely used in Ghana and Nigeria,
-- allowing businesses to accept online card, mobile money, and bank payments.

-- Update payments table constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'bank', 'momo', 'card', 'cheque', 'paystack', 'other'));

-- Update bill_payments table constraint
ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS bill_payments_method_check;
ALTER TABLE bill_payments
  ADD CONSTRAINT bill_payments_method_check
  CHECK (method IN ('cash', 'bank', 'momo', 'cheque', 'card', 'paystack', 'other'));
