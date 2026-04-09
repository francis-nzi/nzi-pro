"""
Quick dataset import endpoint for development/testing.
Imports the 2025 DESNZ conversion factors CSV.
"""

from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from api.auth import _current_user

router = APIRouter()


@router.post("/import-iea-electricity-2025")
def import_iea_electricity_2025(_user: dict[str, str] = Depends(_current_user)):
    """
    Import IEA 2025 country electricity emission factors (Scope 2).
    Creates one dataset per country with a single kgCO2e/kWh factor.
    Safe to run multiple times — upserts existing rows.
    """
    try:
        import import_iea_2025_electricity as iea
        from core.database import get_conn

        inserted_datasets = 0
        inserted_factors  = 0
        updated_factors   = 0

        with get_conn(autocommit=False) as con:
            for country, factor in iea.IEA_FACTORS:
                dataset_id = iea._ensure_country_dataset(con, country)

                existing = con.execute(
                    "SELECT db_id FROM factor_lookup WHERE dataset_id=%s AND scope=%s AND original_id=%s LIMIT 1",
                    [dataset_id, "Scope 2", country],
                ).fetchone()

                if existing:
                    con.execute(
                        """UPDATE factor_lookup
                           SET factor=%s, file_name=%s, year=%s,
                               category=%s, level_1=%s, level_2=%s, column_text=%s,
                               uom=%s, ghg_unit=%s, source=%s, report_label=%s
                           WHERE db_id=%s""",
                        [factor, iea.FILE_NAME, iea.DATASET_YEAR,
                         "Electricity Generation", "Electricity Generation", country,
                         f"Electricity - {country}",
                         "kWh", "kgCO2e", "IEA 2025", f"Electricity {country}",
                         int(existing[0])],
                    )
                    updated_factors += 1
                else:
                    con.execute(
                        """INSERT INTO factor_lookup
                           (dataset_id, file_name, year, original_id, scope,
                            category, level_1, level_2, level_3, level_4, column_text,
                            uom, ghg_unit, factor, source, region, currency,
                            method, valid_from, valid_to, report_label)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,NULL,%s,%s,%s,%s,%s,NULL,NULL,NULL,'2025-01-01','2025-12-31',%s)""",
                        [dataset_id, iea.FILE_NAME, iea.DATASET_YEAR,
                         country, "Scope 2",
                         "Electricity Generation", "Electricity Generation", country,
                         f"Electricity - {country}",
                         "kWh", "kgCO2e", factor, "IEA 2025",
                         f"Electricity {country}"],
                    )
                    inserted_factors  += 1
                    inserted_datasets += 1

        return {
            "ok": True,
            "datasets_created": inserted_datasets,
            "factors_inserted": inserted_factors,
            "factors_updated": updated_factors,
            "total_countries": len(iea.IEA_FACTORS),
            "message": f"IEA 2025: {inserted_datasets} datasets created, {inserted_factors} factors inserted, {updated_factors} updated",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IEA import failed: {e}")


@router.post("/import-sample-dataset")
def import_sample_dataset(_user: dict[str, str] = Depends(_current_user)):
    """
    Import the 2025 DESNZ Activity conversion factors as a sample dataset.
    This is a quick import for development/testing purposes.
    """
    try:
        # Import the ingest function
        from ingest_conversion_factors import ingest_csv
        
        # Path to the sample CSV
        csv_path = Path(__file__).parent.parent / "assets" / "conversion_factors" / "2025-DESNZ-Conversion-Factors-Activity.csv"
        
        if not csv_path.exists():
            raise HTTPException(status_code=404, detail=f"Sample CSV not found at: {csv_path}")
        
        # Ingest the CSV
        dataset_id, factor_count = ingest_csv(csv_path, replace=False)
        
        return {
            "ok": True,
            "dataset_id": dataset_id,
            "factors_imported": factor_count,
            "message": f"Successfully imported {factor_count} conversion factors into dataset {dataset_id}"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import sample dataset: {str(e)}")


@router.post("/import-all-datasets")
def import_all_datasets(
    replace: bool = False,
    _user: dict[str, str] = Depends(_current_user)
):
    """
    Import all conversion factor CSVs from the assets/conversion_factors folder.
    This imports both DESNZ Activity and DEFRA Spend datasets.
    
    Args:
        replace: If True, deletes existing factors for each dataset before importing
    """
    try:
        from ingest_conversion_factors import ingest_csv
        
        # Path to conversion factors folder
        cf_folder = Path(__file__).parent.parent / "assets" / "conversion_factors"
        
        if not cf_folder.exists():
            raise HTTPException(status_code=404, detail=f"Conversion factors folder not found at: {cf_folder}")
        
        # Find all CSV files
        csv_files = sorted([p for p in cf_folder.iterdir() if p.is_file() and p.suffix.lower() == ".csv"])
        
        if not csv_files:
            raise HTTPException(status_code=404, detail=f"No CSV files found in: {cf_folder}")
        
        # Import each CSV
        results = []
        total_factors = 0
        
        for csv_path in csv_files:
            try:
                dataset_id, factor_count = ingest_csv(csv_path, replace=replace)
                total_factors += factor_count
                results.append({
                    "file": csv_path.name,
                    "dataset_id": dataset_id,
                    "factors": factor_count,
                    "status": "success"
                })
            except Exception as e:
                results.append({
                    "file": csv_path.name,
                    "error": str(e),
                    "status": "failed"
                })
        
        return {
            "ok": True,
            "total_factors": total_factors,
            "datasets_imported": len([r for r in results if r["status"] == "success"]),
            "results": results,
            "replaced": replace
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import datasets: {str(e)}")


@router.get("/check-datasets")
def check_datasets(_user: dict[str, str] = Depends(_current_user)):
    """Check if any datasets exist in the system."""
    try:
        from core.database import get_conn
        
        with get_conn() as con:
            result = con.execute("SELECT COUNT(*) FROM datasets").fetchone()
            count = result[0] if result else 0
            
            if count > 0:
                # Get the first dataset
                dataset_row = con.execute(
                    "SELECT dataset_id, name, year, source FROM datasets LIMIT 1"
                ).fetchone()
                
                return {
                    "has_datasets": True,
                    "count": count,
                    "sample_dataset": {
                        "dataset_id": dataset_row[0],
                        "name": dataset_row[1],
                        "year": dataset_row[2],
                        "source": dataset_row[3]
                    } if dataset_row else None
                }
            else:
                return {
                    "has_datasets": False,
                    "count": 0,
                    "message": "No datasets found. Import sample dataset to get started."
                }
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check datasets: {str(e)}")
