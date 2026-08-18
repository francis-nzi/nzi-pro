from __future__ import annotations

from core.database import get_conn


TABLES = ["emission_factor_year_values", "factor_lookup"]


def main() -> None:
    with get_conn(autocommit=False) as con:
        for table in TABLES:
            cur = con.execute(
                f"""
                UPDATE {table}
                SET valid_from = make_date(year, 1, 1),
                    valid_to = make_date(year, 12, 31)
                WHERE year IS NOT NULL
                  AND valid_from IS NOT NULL
                  AND valid_to IS NOT NULL
                  AND (EXTRACT(YEAR FROM valid_from)::int != year
                       OR EXTRACT(YEAR FROM valid_to)::int != year)
                """
            )
            print(f"{table}: {cur.cursor.rowcount} rows fixed")


if __name__ == "__main__":
    main()
