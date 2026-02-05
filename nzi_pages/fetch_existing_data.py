"""
Helper function to fetch existing scope entry data for pre-filling templates.
"""

from core.database import get_conn


def fetch_existing_scope_entries(job_id: int) -> dict:
    """
    Fetch existing scope entry data from job_scope_rows table.
    Returns dict mapping original_id -> {qty, monthly, apply_pct, notes}
    
    Example:
    {
        'FUEL-GAS-001': {
            'qty': 1500,
            'monthly': [100, 120, 130, ...],  # 12 values
            'apply_pct': 100,
            'notes': 'Natural gas usage'
        }
    }
    """
    
    existing_data = {}
    
    with get_conn() as con:
        # Fetch from job_scope_rows (new simplified table)
        result = con.execute("""
            SELECT 
                original_id,
                qty,
                notes
            FROM job_scope_rows
            WHERE job_id = ?
              AND enabled = TRUE
            ORDER BY original_id
        """, [job_id])
        
        while True:
            row = result.fetchone()
            if not row:
                break
            
            original_id = row[0]
            qty = row[1]
            notes = row[2]
            
            existing_data[original_id] = {
                'qty': qty,
                'monthly': [],  # Monthly data not yet implemented in job_scope_rows
                'apply_pct': 100,  # Default
                'notes': notes
            }
        
        # Also check crp_scope_entries (legacy table) if no data in job_scope_rows
        if not existing_data:
            result = con.execute("""
                SELECT 
                    original_id,
                    qty,
                    notes
                FROM crp_scope_entries
                WHERE job_id = ?
                  AND is_archived = FALSE
                ORDER BY original_id
            """, [job_id])
            
            while True:
                row = result.fetchone()
                if not row:
                    break
                
                original_id = row[0]
                qty = row[1]
                notes = row[2]
                
                existing_data[original_id] = {
                    'qty': qty,
                    'monthly': [],
                    'apply_pct': 100,
                    'notes': notes
                }
    
    return existing_data
