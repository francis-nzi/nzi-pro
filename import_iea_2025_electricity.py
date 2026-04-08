#!/usr/bin/env python3
"""
Import IEA 2025 Country Electricity Emission Factors into factor_lookup.

Source: IEA (2025)
Units: kgCO2e/kWh (already in kgCO2e — no conversion required)
Scope: Scope 2
Dataset: "2025-IEA-Electricity" (country = Global)
"""

from core.database import get_conn, db_backend

# IEA 2025 electricity emission factors — kgCO2e per kWh
IEA_FACTORS = [
    ("Algeria",                     0.5001),
    ("Argentina",                   0.2575),
    ("Australia",                   0.5834),
    ("Austria",                     0.0999),
    ("Belgium",                     0.1414),
    ("Brazil",                      0.0658),
    ("Bulgaria",                    0.3236),
    ("Canada",                      0.1190),
    ("Chile",                       0.2210),
    ("China",                       0.5892),
    ("Colombia",                    0.2104),
    ("Croatia",                     0.1483),
    ("Czech Republic",              0.3903),
    ("Denmark",                     0.0620),
    ("Egypt",                       0.4000),
    ("Estonia",                     0.4539),
    ("Finland",                     0.0415),
    ("France",                      0.0413),
    ("Germany",                     0.3313),
    ("Greece",                      0.2947),
    ("Hungary",                     0.1529),
    ("India",                       0.7473),
    ("Indonesia",                   0.7528),
    ("Ireland",                     0.2413),
    ("Israel",                      0.3976),
    ("Italy",                       0.2574),
    ("Japan",                       0.4482),
    ("Kazakhstan",                  0.6061),
    ("Korea, Republic of",          0.4557),
    ("Lithuania",                   0.0679),
    ("Malaysia",                    0.6154),
    ("Mexico",                      0.4205),
    ("Netherlands",                 0.2333),
    ("New Zealand",                 0.0899),
    ("Nigeria",                     0.4035),
    ("Norway",                      0.0055),
    ("Peru",                        0.2213),
    ("Philippines",                 0.7702),
    ("Poland",                      0.5438),
    ("Puerto Rico",                 0.6086),
    ("Qatar",                       0.4606),
    ("Romania",                     0.2253),
    ("Saudi Arabia",                0.5967),
    ("Serbia",                      0.6693),
    ("Singapore",                   0.3776),
    ("Slovakia",                    0.0972),
    ("South Africa",                0.8726),
    ("Spain",                       0.1327),
    ("Sweden",                      0.0099),
    ("Switzerland",                 0.0213),
    ("Taiwan (Chinese Taipei)",     0.5541),
    ("Thailand",                    0.4324),
    ("Turkiye",                     0.4142),
    ("United Arab Emirates",        0.3582),
    ("United States",               0.3308),
    ("Viet Nam",                    0.5584),
]

DATASET_NAME   = "2025-IEA-Electricity"
DATASET_SOURCE = "IEA"
DATASET_YEAR   = 2025
FILE_NAME      = "IEA-2025-Electricity-Factors.csv"


def _ensure_dataset(con) -> int:
    """Return existing dataset_id or create new one."""
    row = con.execute(
        """
        SELECT dataset_id FROM datasets
        WHERE name=%s AND source=%s AND year=%s
        ORDER BY dataset_id DESC LIMIT 1
        """,
        [DATASET_NAME, DATASET_SOURCE, DATASET_YEAR],
    ).fetchone()
    if row:
        return int(row[0])

    new_row = con.execute(
        """
        INSERT INTO datasets (name, source, analysis_type, country, region, currency, year, version, license, notes)
        VALUES (%s, %s, %s, %s, NULL, NULL, %s, %s, NULL, %s)
        RETURNING dataset_id
        """,
        [
            DATASET_NAME,
            DATASET_SOURCE,
            "Activity",
            "Global",
            DATASET_YEAR,
            str(DATASET_YEAR),
            "IEA 2025 CO2 emission intensity of electricity generation, by country",
        ],
    ).fetchone()
    return int(new_row[0])


def run():
    with get_conn(autocommit=False) as con:
        dataset_id = _ensure_dataset(con)
        print(f"Dataset ID: {dataset_id} ({DATASET_NAME})")

        inserted = 0
        skipped = 0

        for country, factor in IEA_FACTORS:
            original_id = country
            report_label = f"Electricity {country}"

            # Upsert: update if exists, insert if not
            existing = con.execute(
                """
                SELECT db_id FROM factor_lookup
                WHERE dataset_id=%s AND scope=%s AND original_id=%s
                LIMIT 1
                """,
                [dataset_id, "Scope 2", original_id],
            ).fetchone()

            if existing:
                con.execute(
                    """
                    UPDATE factor_lookup
                    SET factor=%s, file_name=%s, year=%s,
                        level_1=%s, level_2=%s, column_text=%s,
                        uom=%s, ghg_unit=%s, source=%s, report_label=%s
                    WHERE db_id=%s
                    """,
                    [
                        factor, FILE_NAME, DATASET_YEAR,
                        "Electricity Generation", country, f"Electricity - {country}",
                        "kWh", "kgCO2e", "IEA 2025",
                        report_label,
                        int(existing[0]),
                    ],
                )
                skipped += 1
            else:
                con.execute(
                    """
                    INSERT INTO factor_lookup
                    (dataset_id, file_name, year, original_id, scope,
                     level_1, level_2, level_3, level_4, column_text,
                     uom, ghg_unit, factor, source, region, currency,
                     method, valid_from, valid_to, report_label)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,NULL,%s,%s,%s,%s,%s,NULL,NULL,NULL,NULL,NULL,%s)
                    """,
                    [
                        dataset_id, FILE_NAME, DATASET_YEAR,
                        original_id, "Scope 2",
                        "Electricity Generation", country,
                        f"Electricity - {country}",
                        "kWh", "kgCO2e", factor,
                        "IEA 2025",
                        report_label,
                    ],
                )
                inserted += 1

        print(f"Done: {inserted} inserted, {skipped} updated")
        print(f"Total countries: {len(IEA_FACTORS)}")


if __name__ == "__main__":
    run()
