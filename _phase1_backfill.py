"""
Phase 1 backfill: populates emission_factor_definitions,
emission_factor_year_values, and emission_factor_aliases
from the existing factor_lookup table.

Family grouping key:
    (source, level_1, level_2, level_3, level_4, scope, uom, ghg_unit)

For each family, the canonical row (lowest db_id) supplies the factor_id
and all definition-level metadata. Every row in the family becomes one
year-value row. Every (dataset_id, original_id) becomes one alias row.

Run with --dry-run to see counts without writing anything.
"""
import sys
from dotenv import load_dotenv
load_dotenv(override=True)
from core.database import get_conn

DRY_RUN = '--dry-run' in sys.argv


def normalise(v):
    if v is None:
        return ''
    s = str(v).strip()
    if s.lower() in ('nan', 'none', 'null'):
        return ''
    return s


def family_key(row):
    # row columns: db_id, dataset_id, original_id, year, source, scope,
    #              level_1, level_2, level_3, level_4, uom, ghg_unit,
    #              category, report_label, method, region, factor,
    #              currency, valid_from, valid_to
    return (
        normalise(row[4]),   # source
        normalise(row[6]),   # level_1
        normalise(row[7]),   # level_2
        normalise(row[8]),   # level_3
        normalise(row[9]),   # level_4
        normalise(row[5]),   # scope
        normalise(row[10]),  # uom
        normalise(row[11]),  # ghg_unit
    )


def run():
    print('Phase 1 backfill' + (' [DRY RUN]' if DRY_RUN else ''))
    print()

    with get_conn(autocommit=False) as con:

        # ── Guard: abort if already backfilled ────────────────────────────────
        existing = con.execute(
            'SELECT COUNT(*) FROM emission_factor_definitions'
        ).fetchone()[0]
        if existing > 0:
            print('emission_factor_definitions already has ' + str(existing) + ' rows.')
            print('Backfill already run. Aborting to avoid duplicates.')
            return

        # ── Load all factor_lookup rows into memory ───────────────────────────
        print('Loading factor_lookup into memory...')
        all_rows = con.execute('''
            SELECT db_id, dataset_id, original_id, year,
                   source, scope, level_1, level_2, level_3, level_4,
                   uom, ghg_unit, category, report_label, method, region,
                   factor, currency, valid_from, valid_to
            FROM factor_lookup
            ORDER BY db_id
        ''').fetchall()
        print('  Loaded: ' + str(len(all_rows)) + ' rows')

        # ── Step 1: Build family map in Python ────────────────────────────────
        print('Step 1: Building family map...')
        family_canonical = {}   # family_key -> canonical db_id
        row_to_factor_id = {}   # db_id -> canonical db_id

        for row in all_rows:
            key = family_key(row)
            db_id = row[0]
            if key not in family_canonical:
                family_canonical[key] = db_id
            row_to_factor_id[db_id] = family_canonical[key]

        print('  Families identified: ' + str(len(family_canonical)))

        # ── Step 2: Insert emission_factor_definitions (batch) ────────────────
        print('Step 2: Inserting definitions...')
        canonical_rows = {row[0]: row for row in all_rows if row[0] in set(family_canonical.values())}

        defs_params = [
            [
                row[0],   # factor_id = db_id
                row[4],   # source
                row[5],   # scope
                row[12],  # category
                row[6],   # level_1
                row[7],   # level_2
                row[8],   # level_3
                row[9],   # level_4
                row[13],  # report_label
                row[10],  # uom
                row[11],  # ghg_unit
                row[14],  # method
                row[15],  # region
            ]
            for _, canonical_db_id in sorted(family_canonical.items(), key=lambda x: x[1])
            for row in [canonical_rows[canonical_db_id]]
        ]

        if not DRY_RUN:
            con.executemany('''
                INSERT INTO emission_factor_definitions
                    (factor_id, source, scope, category, level_1, level_2, level_3, level_4,
                     report_label, uom, ghg_unit, method, region)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (factor_id) DO NOTHING
            ''', defs_params)
        print('  Definitions: ' + str(len(defs_params)))

        # ── Step 3: Insert emission_factor_year_values (batch) ────────────────
        print('Step 3: Inserting year-values...')
        yv_params = [
            [
                row_to_factor_id[row[0]],
                row[1],   # dataset_id
                row[2],   # original_id
                row[3],   # year
                row[16],  # factor
                row[17],  # currency
                row[18],  # valid_from
                row[19],  # valid_to
            ]
            for row in all_rows
        ]

        if not DRY_RUN:
            con.executemany('''
                INSERT INTO emission_factor_year_values
                    (factor_id, dataset_id, original_id, year,
                     factor, currency, valid_from, valid_to)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            ''', yv_params)
        print('  Year-values: ' + str(len(yv_params)))

        # ── Step 4: Insert emission_factor_aliases (batch) ────────────────────
        print('Step 4: Inserting aliases...')
        seen_alias_keys = set()
        alias_params = []
        for row in all_rows:
            ak = (row[1], row[2])
            if ak in seen_alias_keys or row[2] is None:
                continue
            seen_alias_keys.add(ak)
            alias_params.append([row[1], row[2], row_to_factor_id[row[0]]])

        if not DRY_RUN:
            con.executemany('''
                INSERT INTO emission_factor_aliases
                    (dataset_id, original_id, factor_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (dataset_id, original_id) DO NOTHING
            ''', alias_params)
        print('  Aliases: ' + str(len(alias_params)))

        # ── Step 5: Sanity checks ─────────────────────────────────────────────
        print()
        print('Step 5: Sanity checks...')

        if not DRY_RUN:
            n_defs  = con.execute('SELECT COUNT(*) FROM emission_factor_definitions').fetchone()[0]
            n_yv    = con.execute('SELECT COUNT(*) FROM emission_factor_year_values').fetchone()[0]
            n_alias = con.execute('SELECT COUNT(*) FROM emission_factor_aliases').fetchone()[0]
            n_fl    = con.execute('SELECT COUNT(*) FROM factor_lookup').fetchone()[0]

            print('  emission_factor_definitions: ' + str(n_defs))
            print('  emission_factor_year_values: ' + str(n_yv) + ' (must equal factor_lookup: ' + str(n_fl) + ')')
            print('  emission_factor_aliases:     ' + str(n_alias))
            print('  factor_lookup (unchanged):   ' + str(n_fl))

            ok = True

            if n_yv != n_fl:
                print('  FAIL  year-value count mismatch')
                ok = False
            else:
                print('  PASS  year-value count matches factor_lookup')

            orphan = con.execute('''
                SELECT COUNT(*) FROM factor_lookup fl
                WHERE NOT EXISTS (
                    SELECT 1 FROM emission_factor_year_values yv
                    WHERE yv.dataset_id  = fl.dataset_id
                      AND yv.original_id = fl.original_id
                )
            ''').fetchone()[0]
            if orphan == 0:
                print('  PASS  all factor_lookup rows have a year-value')
            else:
                print('  FAIL  ' + str(orphan) + ' factor_lookup rows without year-value')
                ok = False

            bad_def = con.execute('''
                SELECT COUNT(*) FROM emission_factor_year_values yv
                WHERE NOT EXISTS (
                    SELECT 1 FROM emission_factor_definitions d
                    WHERE d.factor_id = yv.factor_id
                )
            ''').fetchone()[0]
            if bad_def == 0:
                print('  PASS  all year-values reference valid definitions')
            else:
                print('  FAIL  ' + str(bad_def) + ' year-values with missing definition')
                ok = False

            if not ok:
                raise RuntimeError('Backfill integrity check failed')
        else:
            print('  [dry run - no integrity checks run]')

        print()
        if DRY_RUN:
            print('Dry run complete. No data written.')
        else:
            print('Backfill complete.')


run()
