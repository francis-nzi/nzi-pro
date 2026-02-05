"""
Intelligent dataset selection based on job reporting period.
Automatically selects datasets that cover the reporting period and supports
multiple datasets per scope (Activity + Spend + Custom).
"""

from datetime import datetime, date
from typing import List, Dict, Tuple
from core.database import get_conn


def get_applicable_datasets(job_id: int) -> Dict[str, List[int]]:
    """
    Auto-select datasets based on job's reporting period.
    Returns dict with scope -> list of dataset_ids (Activity + Spend + Custom).
    
    Example:
    {
        'Scope 1': [3, 2, 999],  # Activity, Spend, Custom
        'Scope 2': [3, 2, 999],
        'Scope 3': [3, 2, 999]
    }
    """
    with get_conn() as con:
        # Get job's reporting period
        job_row = con.execute(
            """
            SELECT reporting_period_start, reporting_period_end, reporting_year
            FROM jobs
            WHERE job_id = ?
            """,
            [job_id]
        ).fetchone()
        
        if not job_row:
            raise ValueError(f"Job {job_id} not found")
        
        period_start = job_row[0]
        period_end = job_row[1]
        reporting_year = job_row[2]
        
        # If no explicit period, derive from reporting_year
        if not period_start and reporting_year:
            period_start = date(reporting_year, 1, 1)
            period_end = date(reporting_year, 12, 31)
        
        if not period_start or not period_end:
            # Fallback: use all datasets
            result = con.execute("SELECT dataset_id FROM datasets WHERE dataset_id < 900")
            dataset_ids = []
            while True:
                row = result.fetchone()
                if not row:
                    break
                dataset_ids.append(row[0])
            
            return {
                'Scope 1': dataset_ids + [999],  # 999 = custom factors
                'Scope 2': dataset_ids + [999],
                'Scope 3': dataset_ids + [999]
            }
        
        # Find datasets that overlap with reporting period
        result = con.execute(
            """
            SELECT dataset_id, analysis_type, valid_from, valid_to
            FROM datasets
            WHERE dataset_id < 900
              AND (
                (valid_from IS NULL OR valid_from <= ?)
                AND (valid_to IS NULL OR valid_to >= ?)
              )
            ORDER BY dataset_id
            """,
            [period_end, period_start]
        )
        
        activity_datasets = []
        spend_datasets = []
        
        while True:
            row = result.fetchone()
            if not row:
                break
            dataset_id = row[0]
            analysis_type = (row[1] or "").lower()
            
            if "activity" in analysis_type:
                activity_datasets.append(dataset_id)
            elif "spend" in analysis_type:
                spend_datasets.append(dataset_id)
            else:
                # Unknown type - include in both
                activity_datasets.append(dataset_id)
                spend_datasets.append(dataset_id)
        
        # Combine: Activity + Spend + Custom (999)
        all_datasets = list(set(activity_datasets + spend_datasets)) + [999]
        
        return {
            'Scope 1': all_datasets,
            'Scope 2': all_datasets,
            'Scope 3': all_datasets
        }


def get_monthly_headers(job_id: int) -> List[str]:
    """
    Generate monthly column headers based on job's reporting period.
    Returns list of 12 headers in MM/YYYY format.
    
    Example for Aug 2024 - Jul 2025:
    ['08/2024', '09/2024', '10/2024', ..., '07/2025']
    """
    with get_conn() as con:
        job_row = con.execute(
            """
            SELECT reporting_period_start, reporting_period_end, reporting_year
            FROM jobs
            WHERE job_id = ?
            """,
            [job_id]
        ).fetchone()
        
        if not job_row:
            raise ValueError(f"Job {job_id} not found")
        
        period_start = job_row[0]
        period_end = job_row[1]
        reporting_year = job_row[2]
        
        # If no explicit period, derive from reporting_year (Jan-Dec)
        if not period_start and reporting_year:
            period_start = date(reporting_year, 1, 1)
        
        if not period_start:
            # Fallback: use current year
            period_start = date(datetime.now().year, 1, 1)
        
        # Generate 12 monthly headers starting from period_start
        headers = []
        current = period_start
        
        for _ in range(12):
            headers.append(f"{current.month:02d}/{current.year}")
            
            # Move to next month
            if current.month == 12:
                current = date(current.year + 1, 1, 1)
            else:
                current = date(current.year, current.month + 1, 1)
        
        return headers


def get_reporting_period_display(job_id: int) -> str:
    """
    Get human-readable reporting period string.
    Example: "Aug 2024 - Jul 2025"
    """
    with get_conn() as con:
        job_row = con.execute(
            """
            SELECT reporting_period_start, reporting_period_end, reporting_year
            FROM jobs
            WHERE job_id = ?
            """,
            [job_id]
        ).fetchone()
        
        if not job_row:
            return "Unknown"
        
        period_start = job_row[0]
        period_end = job_row[1]
        reporting_year = job_row[2]
        
        if not period_start and reporting_year:
            return f"Jan {reporting_year} - Dec {reporting_year}"
        
        if not period_start or not period_end:
            return "Not configured"
        
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        
        start_str = f"{months[period_start.month - 1]} {period_start.year}"
        end_str = f"{months[period_end.month - 1]} {period_end.year}"
        
        return f"{start_str} - {end_str}"
