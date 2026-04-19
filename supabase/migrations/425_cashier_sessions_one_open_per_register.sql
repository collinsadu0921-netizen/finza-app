-- At most one open cashier_session per physical register (retail multi-till safety).
-- 1) Close duplicate "open" rows per register_id, keeping the earliest started session.
-- 2) Enforce with a partial unique index.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY register_id
      ORDER BY started_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.cashier_sessions
  WHERE status = 'open'
    AND register_id IS NOT NULL
)
UPDATE public.cashier_sessions cs
SET
  status = 'closed',
  ended_at = COALESCE(cs.ended_at, NOW()),
  closing_amount = COALESCE(cs.opening_float, cs.opening_cash, 0),
  closing_cash = COALESCE(cs.opening_float, cs.opening_cash, 0)
FROM ranked r
WHERE cs.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashier_sessions_one_open_per_register
  ON public.cashier_sessions (register_id)
  WHERE (status = 'open' AND register_id IS NOT NULL);

COMMENT ON INDEX idx_cashier_sessions_one_open_per_register IS
  'Retail: prevents more than one open session per register (drawer).';
