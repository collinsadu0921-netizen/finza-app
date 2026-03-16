--------------------------------------------------
-- Enable RLS on businesses
--------------------------------------------------

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

--------------------------------------------------
-- Owners can read their own business
--------------------------------------------------

DROP POLICY IF EXISTS "Owners can select own business" ON public.businesses;
CREATE POLICY "Owners can select own business"
ON public.businesses
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
);

--------------------------------------------------
-- Members can read businesses they belong to
--------------------------------------------------

DROP POLICY IF EXISTS "Business members can select their businesses" ON public.businesses;
CREATE POLICY "Business members can select their businesses"
ON public.businesses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = businesses.id
      AND bu.user_id = auth.uid()
  )
);

--------------------------------------------------
