-- Helper function to check engagement without RLS recursion
CREATE OR REPLACE FUNCTION public.has_firm_engagement_with_business(_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.firm_client_engagements fce
    JOIN public.accounting_firm_users afu
      ON afu.firm_id = fce.accounting_firm_id
     AND afu.user_id = auth.uid()
    WHERE fce.client_business_id = _business_id
  );
$$;

COMMENT ON FUNCTION public.has_firm_engagement_with_business(uuid)
IS 'Breaks RLS recursion by checking firm engagement via SECURITY DEFINER';

-- Replace recursive businesses policy
DROP POLICY IF EXISTS "Firm users can select engaged client businesses"
ON public.businesses;

CREATE POLICY "Firm users can select engaged client businesses"
ON public.businesses
FOR SELECT
TO authenticated
USING (
  public.has_firm_engagement_with_business(businesses.id)
);
