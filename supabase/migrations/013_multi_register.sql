-- Create registers table
CREATE TABLE IF NOT EXISTS registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Create cashier_sessions table
CREATE TABLE IF NOT EXISTS cashier_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid REFERENCES registers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  opening_float numeric NOT NULL,
  closing_amount numeric,
  status text CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  started_at timestamp DEFAULT now(),
  ended_at timestamp
);

-- Link sales to registers and sessions
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES registers(id) ON DELETE SET NULL;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cashier_session_id uuid REFERENCES cashier_sessions(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_registers_business_id ON registers(business_id);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_register_id ON cashier_sessions(register_id);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_user_id ON cashier_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_status ON cashier_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sales_register_id ON sales(register_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_session_id ON sales(cashier_session_id);


















