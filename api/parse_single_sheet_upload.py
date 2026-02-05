"""
Parse single-sheet Excel upload format.
Handles the new simplified template with all scopes in one sheet.
"""

import pandas as pd
from openpyxl import load_workbook
from io import BytesIO
from core.database import get_conn, db_backend


def is_single_sheet_format(wb) -> bool:
    """
    Detect if uploaded workbook is single-sheet format.
    Single-sheet format has a sheet named "Data Upload" or has only 1 sheet with columns:
    Scope, Category, Report Label, ID, UOM, GHG Unit, Factor, Qty
    """
    if "Data Upload" in wb.sheetnames:
        return True
    
    # If only 1 sheet and has the right columns, assume single-sheet
    if len(wb.sheetnames) == 1:
        ws = wb[wb.sheetnames[0]]
        # Check for header row with expected columns
        for r in range(1, 10):
            row_values = [ws.cell(row=r, column=c).value for c in range(1, 25)]
            norm = [str(x).strip().lower() if x else "" for x in row_values]
            if "scope" in norm and "report label" in norm and "id" in norm and "qty" in norm:
                return True
    
    return False


def parse_single_sheet_upload(
    raw_bytes: bytes,
    job_id: int,
    datasets_by_scope: dict[str, int]
) -> tuple[list[dict], list[str], list[str], dict]:
    """
    Parse single-sheet Excel upload.
    
    Args:
        raw_bytes: Excel file bytes
        job_id: Job ID
        datasets_by_scope: Map of scope name to dataset_id
    
    Returns:
        (rows_ready, errors, warnings, details)
    """
    
    errors = []
    warnings = []
    details = {}
    rows_ready = []
    
    try:
        wb = load_workbook(BytesIO(raw_bytes), data_only=True)
    except Exception as e:
        errors.append(f"Failed to load Excel file: {e}")
        return rows_ready, errors, warnings, details
    
    # Find the data sheet
    ws = None
    if "Data Upload" in wb.sheetnames:
        ws = wb["Data Upload"]
    elif len(wb.sheetnames) == 1:
        ws = wb[wb.sheetnames[0]]
    else:
        errors.append("Could not find 'Data Upload' sheet in single-sheet template")
        return rows_ready, errors, warnings, details
    
    # Find header row
    header_row = None
    col_indices = {}
    
    for r in range(1, 20):
        row_values = [ws.cell(row=r, column=c).value for c in range(1, 30)]
        norm = [str(x).strip().lower() if x else "" for x in row_values]
        
        if "scope" in norm and "id" in norm and "qty" in norm:
            header_row = r
            for col_name in ["scope", "category", "report label", "id", "uom", "ghg unit", "factor", "qty", "apply", "notes"]:
                if col_name in norm:
                    col_indices[col_name] = norm.index(col_name) + 1
            break
    
    if header_row is None:
        errors.append("Could not find header row with columns: Scope, ID, Qty")
        return rows_ready, errors, warnings, details
    
    details["header_row"] = header_row
    details["columns_found"] = list(col_indices.keys())
    
    # Parse data rows (skip rows with blank Qty)
    parsed_rows = []
    
    for r in range(header_row + 1, ws.max_row + 1):
        # Get ID and Qty
        id_col = col_indices.get("id")
        qty_col = col_indices.get("qty")
        scope_col = col_indices.get("scope")
        
        if not id_col or not qty_col or not scope_col:
            continue
        
        oid = ws.cell(row=r, column=id_col).value
        qty_val = ws.cell(row=r, column=qty_col).value
        scope_val = ws.cell(row=r, column=scope_col).value
        
        # Skip if ID is blank
        if not oid or str(oid).strip() == "":
            continue
        
        # **CRITICAL: Skip if Qty is blank (ignore blank rows)**
        if qty_val is None or str(qty_val).strip() == "" or str(qty_val).strip() == "-":
            continue
        
        try:
            qty_float = float(qty_val)
            if qty_float == 0:
                continue  # Skip zero quantities
        except (ValueError, TypeError):
            continue  # Skip invalid quantities
        
        # Parse scope
        scope_name = None
        if scope_val:
            s = str(scope_val).strip()
            if "scope 1" in s.lower():
                scope_name = "Scope 1"
            elif "scope 2" in s.lower():
                scope_name = "Scope 2"
            elif "scope 3" in s.lower():
                scope_name = "Scope 3"
        
        if not scope_name:
            warnings.append(f"Row {r}: Could not determine scope from '{scope_val}'")
            continue
        
        # Parse Apply% if present
        apply_col = col_indices.get("apply")
        apply_pct = 100.0  # Default
        if apply_col:
            apply_val = ws.cell(row=r, column=apply_col).value
            if apply_val:
                try:
                    # Handle "100%" or 100 or 1.0
                    apply_str = str(apply_val).strip().replace("%", "")
                    apply_pct = float(apply_str)
                except (ValueError, TypeError):
                    apply_pct = 100.0
        
        # Get notes if present
        notes_col = col_indices.get("notes")
        notes = None
        if notes_col:
            notes_val = ws.cell(row=r, column=notes_col).value
            if notes_val:
                notes = str(notes_val).strip()
        
        parsed_rows.append({
            "scope": scope_name,
            "original_id": str(oid).strip(),
            "qty": qty_float,
            "apply_pct": apply_pct,
            "notes": notes,
            "row_number": r
        })
    
    details["parsed_row_count"] = len(parsed_rows)
    
    if not parsed_rows:
        errors.append("No data rows found with non-blank Qty values")
        return rows_ready, errors, warnings, details
    
    # Factor lookup for each scope
    missing_ids = {}
    
    for scope_name in ["Scope 1", "Scope 2", "Scope 3"]:
        scope_rows = [r for r in parsed_rows if r["scope"] == scope_name]
        if not scope_rows:
            continue
        
        dataset_id = datasets_by_scope.get(scope_name)
        if not dataset_id:
            errors.append(f"{scope_name}: No dataset selected in job configuration")
            continue
        
        # Get all IDs for this scope
        ids = list(set([r["original_id"] for r in scope_rows]))
        
        # Lookup factors (check both factor_lookup and custom_conversion_factors)
        factor_map = _lookup_factors(dataset_id, scope_name, ids, job_id)
        
        # Check for missing IDs
        missing = [oid for oid in ids if oid not in factor_map]
        if missing:
            missing_ids[scope_name] = missing[:50]
            errors.append(f"{scope_name}: {len(missing)} IDs not found in factor database")
        
        # Build rows_ready
        for r in scope_rows:
            oid = r["original_id"]
            if oid not in factor_map:
                continue
            
            factor_info = factor_map[oid]
            
            # Calculate tCO2e
            qty = r["qty"]
            factor = factor_info["factor"]
            apply_pct = r["apply_pct"]
            ghg_unit = factor_info.get("ghg_unit", "kgCO2e")
            
            # Convert to tCO2e
            emissions = qty * factor * (apply_pct / 100.0)
            if "kg" in ghg_unit.lower():
                emissions = emissions / 1000.0  # kg to tonnes
            
            rows_ready.append({
                "scope": scope_name,
                "dataset_id": dataset_id,
                "db_id": factor_info.get("db_id"),
                "original_id": oid,
                "qty": qty,
                "uom": factor_info.get("uom"),
                "ghg_unit": ghg_unit,
                "factor": factor,
                "calc_tco2e": round(emissions, 4),
                "level_1": factor_info.get("level_1"),
                "level_2": factor_info.get("level_2"),
                "level_3": factor_info.get("level_3"),
                "level_4": factor_info.get("level_4"),
                "column_text": factor_info.get("column_text"),
                "report_label": factor_info.get("report_label"),
                "apply_pct": apply_pct,
                "notes": r.get("notes")
            })
    
    details["missing_ids"] = missing_ids
    details["rows_ready_count"] = len(rows_ready)
    
    return rows_ready, errors, warnings, details


def _lookup_factors(dataset_id: int, scope: str, original_ids: list[str], job_id: int) -> dict[str, dict]:
    """
    Lookup factors from factor_lookup and custom_conversion_factors.
    Returns dict mapping original_id -> factor info
    """
    factor_map = {}
    
    with get_conn() as con:
        # Standard factors
        if db_backend() == "postgres":
            sql = """
                SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                       column_text, uom, ghg_unit, factor, report_label
                FROM factor_lookup
                WHERE dataset_id=%s AND scope=%s AND original_id = ANY(%s)
            """
            df = con.execute(sql, [dataset_id, scope, original_ids]).df()
        else:
            ph = ",".join(["?"] * len(original_ids))
            sql = f"""
                SELECT db_id, original_id, level_1, level_2, level_3, level_4,
                       column_text, uom, ghg_unit, factor, report_label
                FROM factor_lookup
                WHERE dataset_id=? AND scope=? AND original_id IN ({ph})
            """
            df = con.execute(sql, [dataset_id, scope] + original_ids).df()
        
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                oid = str(row["original_id"]).strip()
                factor_map[oid] = {
                    "db_id": int(row["db_id"]) if pd.notna(row["db_id"]) else None,
                    "original_id": oid,
                    "level_1": row.get("level_1"),
                    "level_2": row.get("level_2"),
                    "level_3": row.get("level_3"),
                    "level_4": row.get("level_4"),
                    "column_text": row.get("column_text"),
                    "uom": row.get("uom"),
                    "ghg_unit": row.get("ghg_unit"),
                    "factor": float(row["factor"]) if pd.notna(row["factor"]) else 0.0,
                    "report_label": row.get("report_label")
                }
        
        # Custom factors (check by custom_id matching original_ids)
        custom_ph = ",".join(["?"] * len(original_ids))
        custom_sql = f"""
            SELECT custom_factor_id, custom_id, level_1, level_2, level_3, level_4,
                   uom, ghg_unit, factor, report_label, category
            FROM custom_conversion_factors
            WHERE scope=? AND custom_id IN ({custom_ph})
              AND (job_id=? OR job_id IS NULL)
              AND is_active=TRUE
        """
        
        custom_df = con.execute(custom_sql, [scope] + original_ids + [job_id]).df()
        
        if custom_df is not None and not custom_df.empty:
            for _, row in custom_df.iterrows():
                cid = str(row["custom_id"]).strip()
                # Custom factors override standard factors
                factor_map[cid] = {
                    "db_id": None,  # Custom factors don't have db_id in factor_lookup
                    "custom_factor_id": int(row["custom_factor_id"]),
                    "original_id": cid,
                    "level_1": row.get("level_1"),
                    "level_2": row.get("level_2"),
                    "level_3": row.get("level_3"),
                    "level_4": row.get("level_4"),
                    "column_text": row.get("category"),
                    "uom": row.get("uom"),
                    "ghg_unit": row.get("ghg_unit"),
                    "factor": float(row["factor"]) if pd.notna(row["factor"]) else 0.0,
                    "report_label": row.get("report_label")
                }
    
    return factor_map
