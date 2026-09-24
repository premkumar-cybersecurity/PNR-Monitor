-- Run this ONCE in Supabase SQL Editor before going live.
-- It removes the temporary SMS phone column and clears the test history
-- for the PNR used during local testing, then keeps the current status
-- as the single initial history entry.

ALTER TABLE public.pnrs
DROP COLUMN IF EXISTS phone_number;

DELETE FROM public.status_history
WHERE pnr_id IN (
  SELECT id
  FROM public.pnrs
  WHERE pnr_number = '6950215401'
);

INSERT INTO public.status_history (pnr_id, old_status, new_status, checked_at)
SELECT id, NULL, current_status, COALESCE(last_checked_at, now())
FROM public.pnrs
WHERE pnr_number = '6950215401'
  AND active = true;
