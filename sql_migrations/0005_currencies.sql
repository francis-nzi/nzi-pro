CREATE TABLE IF NOT EXISTS public.currencies_lookup (
  currency_code text primary key,
  symbol text not null,
  name text,
  is_active boolean not null default true
);

INSERT INTO public.currencies_lookup (currency_code, symbol, name, is_active)
SELECT 'GBP', '£', 'Pound Sterling', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.currencies_lookup WHERE currency_code='GBP');

INSERT INTO public.currencies_lookup (currency_code, symbol, name, is_active)
SELECT 'USD', '$', 'US Dollar', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.currencies_lookup WHERE currency_code='USD');

INSERT INTO public.currencies_lookup (currency_code, symbol, name, is_active)
SELECT 'EUR', '€', 'Euro', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.currencies_lookup WHERE currency_code='EUR');
