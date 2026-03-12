# Supabase Hardening Runbook (Backend-Only Pattern)

## Goal
Reduce Supabase Security Advisor findings for:
- `RLS Disabled in Public`
- `Security Definer View`

This runbook assumes your app accesses Postgres from backend services only (via `DATABASE_URL`), not directly from browser Supabase client keys.

## Scripts
- Harden: `sql_migrations/0021_supabase_security_hardening_backend_only.sql`
- Rollback: `sql_migrations/0022_supabase_security_hardening_backend_only_rollback.sql`

## Pre-check (Staging First)
Run in Supabase SQL editor:

```sql
-- Tables without RLS
select schemaname, tablename
from pg_tables
where schemaname='public'
  and rowsecurity = false
order by tablename;

-- Public views and reloptions
select n.nspname as schema_name, c.relname as view_name, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='v'
order by c.relname;
```

## Apply in Staging
1. Open Supabase SQL editor (staging project).
2. Paste and run `0021_supabase_security_hardening_backend_only.sql`.
3. Re-run the pre-check queries.
4. Test app flows:
- Login
- Clients/Jobs list load
- Team invite/reset
- Email outbox load

## Promote to Production
Repeat the same steps in production only after staging is verified.

## If Something Breaks
Run rollback script:
- `0022_supabase_security_hardening_backend_only_rollback.sql`

Then re-test affected flows.

## Notes
- This hardening improves security posture; it is not a performance optimization.
- If you later use Supabase browser client access intentionally, you will need explicit RLS policies per table for `authenticated`.
