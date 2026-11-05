-- ISO 3166 alpha-3 code for country datasets. Set by
-- utils/import_cornerstone_eeio.py, which uses it to find the existing
-- dataset for a country and year when re-importing a newer workbook.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS country_code VARCHAR(8);
