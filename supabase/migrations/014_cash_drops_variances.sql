-- Stage 24B Part 1: Cash Drops, Variances, and Overrides
-- Database migrations only - no UI or business logic changes

-- 1. Create cash_drops table
CREATE TABLE IF NOT EXISTS cash_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount numeric(10,2) NOT NULL,
  reason text,
  before_balance numeric(10,2) NOT NULL,
  after_balance numeric(10,2) NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Create indexes for cash_drops
CREATE INDEX IF NOT EXISTS idx_cash_drops_register_id ON cash_drops(register_id);
CREATE INDEX IF NOT EXISTS idx_cash_drops_session_id ON cash_drops(session_id);
CREATE INDEX IF NOT EXISTS idx_cash_drops_user_id ON cash_drops(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_drops_created_at ON cash_drops(created_at);

-- 2. Create register_variances table
CREATE TABLE IF NOT EXISTS register_variances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  supervisor_id uuid,
  expected numeric(10,2) NOT NULL,
  counted numeric(10,2) NOT NULL,
  difference numeric(10,2) NOT NULL,
  note text,
  created_at timestamp DEFAULT now()
);

-- Create indexes for register_variances
CREATE INDEX IF NOT EXISTS idx_register_variances_register_id ON register_variances(register_id);
CREATE INDEX IF NOT EXISTS idx_register_variances_session_id ON register_variances(session_id);
CREATE INDEX IF NOT EXISTS idx_register_variances_user_id ON register_variances(user_id);
CREATE INDEX IF NOT EXISTS idx_register_variances_supervisor_id ON register_variances(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_register_variances_created_at ON register_variances(created_at);

-- 3. Create overrides table
CREATE TABLE IF NOT EXISTS overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  reference_id uuid,
  cashier_id uuid NOT NULL,
  supervisor_id uuid NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Create indexes for overrides
CREATE INDEX IF NOT EXISTS idx_overrides_action_type ON overrides(action_type);
CREATE INDEX IF NOT EXISTS idx_overrides_reference_id ON overrides(reference_id);
CREATE INDEX IF NOT EXISTS idx_overrides_cashier_id ON overrides(cashier_id);
CREATE INDEX IF NOT EXISTS idx_overrides_supervisor_id ON overrides(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_overrides_created_at ON overrides(created_at);

-- 4. Modify cashier_sessions table - add new fields
ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS opening_cash numeric(10,2) DEFAULT 0;

ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS closing_cash numeric(10,2) DEFAULT 0;

ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS total_drops numeric(10,2) DEFAULT 0;

ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS total_variances numeric(10,2) DEFAULT 0;

ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS supervised_actions_count int DEFAULT 0;
