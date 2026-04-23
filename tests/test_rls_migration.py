from pathlib import Path


def test_force_rls_migration_contains_force_statement():
    sql = Path("sql_migrations/0039_force_rls_org_scoped_tables.sql").read_text(encoding="utf-8")
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "org_id" in sql
    assert "ALTER TABLE public.%I FORCE ROW LEVEL SECURITY" in sql
