ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS currency_code text;

UPDATE public.quotes
SET currency_code = COALESCE(NULLIF(currency_code, ''), 'GBP')
WHERE currency_code IS NULL OR currency_code = '';
