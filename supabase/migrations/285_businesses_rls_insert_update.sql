-- Allow new signups to create a business (owner_id = auth.uid()) and owners to update their business.
-- Without these, RLS blocks INSERT on /business-setup and UPDATE on profile save.

--------------------------------------------------
-- Authenticated users can insert a business they own
--------------------------------------------------
CREATE POLICY "Users can insert business they own"
ON public.businesses
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid());

--------------------------------------------------
-- Owners can update their own business
--------------------------------------------------
CREATE POLICY "Owners can update own business"
ON public.businesses
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());
