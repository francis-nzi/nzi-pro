"""
Populate dataset validity periods based on dataset year and type.
This enables intelligent auto-selection of datasets based on job reporting periods.
"""

import os
from dotenv import load_dotenv
from core.database import get_conn

load_dotenv()

def update_dataset_validity_periods():
    """
    Set valid_from and valid_to dates for each dataset based on its year.
    Datasets are valid for their entire calendar year.
    """
    
    with get_conn() as con:
        # Get all datasets
        result = con.execute("""
            SELECT dataset_id, name, year, analysis_type
            FROM datasets
            WHERE dataset_id < 900
            ORDER BY dataset_id
        """)
        
        datasets = []
        while True:
            row = result.fetchone()
            if not row:
                break
            datasets.append({
                'dataset_id': row[0],
                'name': row[1],
                'year': row[2],
                'analysis_type': row[3]
            })
        
        print(f"Found {len(datasets)} datasets to update\n")
        
        # Update each dataset with validity period
        for ds in datasets:
            dataset_id = ds['dataset_id']
            year = ds['year']
            name = ds['name']
            analysis_type = ds['analysis_type'] or 'Unknown'
            
            if not year:
                print(f"⚠ Dataset {dataset_id} ({name}) has no year - skipping")
                continue
            
            # Set validity to the entire calendar year
            valid_from = f"{year}-01-01"
            valid_to = f"{year}-12-31"
            
            con.execute("""
                UPDATE datasets
                SET valid_from = ?,
                    valid_to = ?
                WHERE dataset_id = ?
            """, [valid_from, valid_to, dataset_id])
            
            print(f"✓ Dataset {dataset_id}: {name} ({analysis_type})")
            print(f"  Valid: {valid_from} to {valid_to}")
        
        print(f"\n✅ Updated {len(datasets)} datasets with validity periods")
        
        # Show summary
        print("\n" + "="*60)
        print("Dataset Summary:")
        print("="*60)
        
        result = con.execute("""
            SELECT 
                dataset_id,
                name,
                analysis_type,
                year,
                valid_from,
                valid_to
            FROM datasets
            WHERE dataset_id < 900
            ORDER BY year DESC, dataset_id
        """)
        
        while True:
            row = result.fetchone()
            if not row:
                break
            print(f"ID {row[0]}: {row[1]} ({row[2]}) - {row[3]}")
            print(f"       Valid: {row[4]} to {row[5]}")

if __name__ == "__main__":
    print("="*60)
    print("Updating Dataset Validity Periods")
    print("="*60 + "\n")
    
    update_dataset_validity_periods()
    
    print("\n" + "="*60)
    print("Complete!")
    print("="*60)
