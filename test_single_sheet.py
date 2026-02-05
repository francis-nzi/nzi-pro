"""
Test script for single-sheet template generation and parsing.
Run this after migrations and factor re-ingestion.
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from nzi_pages.generate_single_sheet_template import generate_single_sheet_template
from api.parse_single_sheet_upload import parse_single_sheet_upload
from core.database import get_conn


def test_template_generation():
    """Test generating a single-sheet template"""
    print("\n=== Testing Single-Sheet Template Generation ===")
    
    # Use job_id 9 (DUMMY-2026-0005-01)
    job_id = 9
    
    try:
        excel_bytes, filename = generate_single_sheet_template(
            job_id=job_id,
            client_name="Bushy Tails",
            site_name="Bristol",
            job_number="DUMMY-2026-0005-01",
            report_from="2025-01-01",
            report_to="2025-12-31",
            include_custom_factors=True
        )
        
        print(f"✓ Template generated successfully")
        print(f"  Filename: {filename}")
        print(f"  Size: {len(excel_bytes):,} bytes")
        
        # Save to file for inspection
        output_path = Path(__file__).parent / "test_output" / filename
        output_path.parent.mkdir(exist_ok=True)
        output_path.write_bytes(excel_bytes)
        print(f"  Saved to: {output_path}")
        
        return excel_bytes
        
    except Exception as e:
        print(f"✗ Template generation failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_factor_lookup():
    """Test that report_label is populated in factor_lookup"""
    print("\n=== Testing Factor Lookup (report_label) ===")
    
    with get_conn() as con:
        # Check if report_label column exists
        cursor = con.execute("""
            SELECT original_id, scope, level_1, level_2, level_3, report_label
            FROM factor_lookup
            WHERE report_label IS NOT NULL
            LIMIT 10
        """)
        
        result = []
        for _ in range(10):
            row = cursor.fetchone()
            if row:
                result.append(row)
            else:
                break
        
        if result:
            print(f"✓ Found {len(result)} factors with report_label populated")
            for row in result[:5]:
                print(f"  {row[0]}: {row[5]}")
        else:
            print("✗ No factors found with report_label populated")
            print("  → Run: python ingest_conversion_factors.py --replace")


def test_custom_factors_table():
    """Test that custom_conversion_factors table exists"""
    print("\n=== Testing Custom Conversion Factors Table ===")
    
    with get_conn() as con:
        try:
            result = con.execute("""
                SELECT COUNT(*) as count
                FROM custom_conversion_factors
            """).fetchone()
            
            print(f"✓ custom_conversion_factors table exists")
            print(f"  Current rows: {result[0]}")
            
        except Exception as e:
            print(f"✗ custom_conversion_factors table not found: {e}")
            print("  → Run migrations first")


def test_upload_parsing(excel_bytes):
    """Test parsing uploaded single-sheet template"""
    print("\n=== Testing Single-Sheet Upload Parsing ===")
    
    if not excel_bytes:
        print("✗ No template bytes to test (generation failed)")
        return
    
    job_id = 9
    
    # Get dataset configuration
    with get_conn() as con:
        df_scopes = con.execute(
            "SELECT scope, dataset_id FROM job_scope_config WHERE job_id=?",
            [job_id],
        ).df()
    
    ds_map = {}
    if df_scopes is not None and not df_scopes.empty:
        for _, row in df_scopes.iterrows():
            scope = str(row.get("scope") or "").strip()
            dsid = row.get("dataset_id")
            if scope and dsid:
                ds_map[scope] = int(dsid)
    
    print(f"  Dataset map: {ds_map}")
    
    try:
        rows_ready, errors, warnings, details = parse_single_sheet_upload(
            excel_bytes, job_id, ds_map
        )
        
        print(f"✓ Parsing completed")
        print(f"  Errors: {len(errors)}")
        print(f"  Warnings: {len(warnings)}")
        print(f"  Rows ready: {len(rows_ready)}")
        
        if errors:
            print("\n  Errors:")
            for err in errors[:5]:
                print(f"    - {err}")
        
        if warnings:
            print("\n  Warnings:")
            for warn in warnings[:5]:
                print(f"    - {warn}")
        
        if rows_ready:
            print("\n  Sample rows:")
            for row in rows_ready[:3]:
                print(f"    {row['scope']}: {row['original_id']} → {row['calc_tco2e']} tCO2e")
        
    except Exception as e:
        print(f"✗ Parsing failed: {e}")
        import traceback
        traceback.print_exc()


def main():
    print("=" * 60)
    print("Single-Sheet Template System Test")
    print("=" * 60)
    
    # Test 1: Check custom_conversion_factors table
    test_custom_factors_table()
    
    # Test 2: Check report_label in factor_lookup
    test_factor_lookup()
    
    # Test 3: Generate template
    excel_bytes = test_template_generation()
    
    # Test 4: Parse template (simulating upload)
    test_upload_parsing(excel_bytes)
    
    print("\n" + "=" * 60)
    print("Test Complete")
    print("=" * 60)


if __name__ == "__main__":
    main()
