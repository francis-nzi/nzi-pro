"""
Run migrations and re-ingest conversion factors with report_label.
This script loads .env automatically.
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from core.migrations import run_migrations
from core.database import get_conn
import subprocess


def main():
    print("=" * 60)
    print("Step 1: Running Migrations")
    print("=" * 60)
    
    try:
        run_migrations()
        print("✓ Migrations completed successfully")
        
        # Verify new columns exist
        with get_conn() as con:
            # Check report_label in factor_lookup
            result = con.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'factor_lookup' 
                  AND column_name = 'report_label'
            """).fetchone()
            
            if result:
                print("✓ report_label column added to factor_lookup")
            else:
                print("✗ report_label column not found in factor_lookup")
            
            # Check custom_conversion_factors table
            result = con.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = 'custom_conversion_factors'
            """).fetchone()
            
            if result:
                print("✓ custom_conversion_factors table created")
            else:
                print("✗ custom_conversion_factors table not found")
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    print("\n" + "=" * 60)
    print("Step 2: Re-ingesting Conversion Factors")
    print("=" * 60)
    print("Running: python ingest_conversion_factors.py --replace")
    print()
    
    try:
        result = subprocess.run(
            [sys.executable, "ingest_conversion_factors.py", "--replace"],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True
        )
        
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        
        if result.returncode == 0:
            print("\n✓ Factor ingestion completed successfully")
        else:
            print(f"\n✗ Factor ingestion failed with exit code {result.returncode}")
            return 1
            
    except Exception as e:
        print(f"✗ Factor ingestion failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    print("\n" + "=" * 60)
    print("Step 3: Verifying report_label Population")
    print("=" * 60)
    
    try:
        with get_conn() as con:
            result = con.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN report_label IS NOT NULL THEN 1 ELSE 0 END) as with_label
                FROM factor_lookup
            """).fetchone()
            
            total = result[0]
            with_label = result[1]
            
            print(f"Total factors: {total:,}")
            print(f"With report_label: {with_label:,}")
            print(f"Coverage: {(with_label/total*100):.1f}%")
            
            if with_label > 0:
                print("\n✓ report_label successfully populated")
                
                # Show sample
                sample_result = con.execute("""
                    SELECT original_id, scope, report_label
                    FROM factor_lookup
                    WHERE report_label IS NOT NULL
                    LIMIT 5
                """)
                
                print("\nSample factors:")
                for _ in range(5):
                    row = sample_result.fetchone()
                    if row:
                        print(f"  {row[0]}: {row[2]}")
                    else:
                        break
            else:
                print("\n✗ report_label not populated")
                return 1
                
    except Exception as e:
        print(f"✗ Verification failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    print("\n" + "=" * 60)
    print("All Steps Completed Successfully!")
    print("=" * 60)
    print("\nNext: Run 'python test_single_sheet.py' to test template generation")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
