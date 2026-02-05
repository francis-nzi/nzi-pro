"""
Calculate reporting periods based on client's financial year end and job's reporting year.

Example:
- Client year end: June
- Benchmark year: 2024 (represents Jul 2023 - Jun 2024)
- Reporting year 2: Jul 2024 - Jun 2025
- Reporting year 3: Jul 2025 - Jun 2026
"""

from datetime import date
from typing import Tuple, Optional

MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12
}


def calculate_reporting_period(
    year_end_month: str,
    benchmark_year: int,
    reporting_year_number: int
) -> Tuple[date, date]:
    """
    Calculate reporting period start and end dates.
    
    Args:
        year_end_month: Client's financial year end month (e.g., "June")
        benchmark_year: The benchmark year (first reporting year)
        reporting_year_number: Which reporting year (1 = benchmark, 2 = next year, etc.)
    
    Returns:
        Tuple of (period_start, period_end)
    
    Example:
        calculate_reporting_period("June", 2024, 1)
        -> (date(2023, 7, 1), date(2024, 6, 30))
        
        calculate_reporting_period("June", 2024, 2)
        -> (date(2024, 7, 1), date(2025, 6, 30))
    """
    
    if not year_end_month or year_end_month not in MONTH_MAP:
        raise ValueError(f"Invalid year_end_month: {year_end_month}")
    
    if not benchmark_year or benchmark_year < 2000:
        raise ValueError(f"Invalid benchmark_year: {benchmark_year}")
    
    if not reporting_year_number or reporting_year_number < 1:
        raise ValueError(f"Invalid reporting_year_number: {reporting_year_number}")
    
    # Get the month number (1-12)
    year_end_month_num = MONTH_MAP[year_end_month]
    
    # Calculate the start year for this reporting period
    # Benchmark year is the END year of the first period
    # So if benchmark_year = 2024 and year_end = June:
    # - Reporting year 1: Jul 2023 - Jun 2024
    # - Reporting year 2: Jul 2024 - Jun 2025
    
    years_offset = reporting_year_number - 1
    period_end_year = benchmark_year + years_offset
    period_start_year = period_end_year - 1
    
    # Start date is the day after year end in the previous year
    # End date is the last day of the year end month
    if year_end_month_num == 12:
        # Special case: December year end means Jan-Dec period
        period_start = date(period_start_year + 1, 1, 1)
        period_end = date(period_end_year, 12, 31)
    else:
        # Start is first day of month after year end
        start_month = year_end_month_num + 1
        period_start = date(period_start_year, start_month, 1)
        
        # End is last day of year end month
        # Calculate last day of month
        if year_end_month_num in [1, 3, 5, 7, 8, 10, 12]:
            last_day = 31
        elif year_end_month_num in [4, 6, 9, 11]:
            last_day = 30
        else:  # February
            # Check for leap year
            if period_end_year % 4 == 0 and (period_end_year % 100 != 0 or period_end_year % 400 == 0):
                last_day = 29
            else:
                last_day = 28
        
        period_end = date(period_end_year, year_end_month_num, last_day)
    
    return period_start, period_end


def get_reporting_period_for_job(
    client_year_end_month: Optional[str],
    client_benchmark_year: Optional[int],
    job_reporting_year: Optional[int]
) -> Tuple[Optional[date], Optional[date]]:
    """
    Get reporting period for a job based on client settings.
    Returns (None, None) if insufficient information.
    
    Args:
        client_year_end_month: Client's financial year end month
        client_benchmark_year: Client's benchmark year
        job_reporting_year: Job's reporting year number
    
    Returns:
        Tuple of (period_start, period_end) or (None, None)
    """
    
    if not client_year_end_month or not client_benchmark_year or not job_reporting_year:
        return None, None
    
    try:
        return calculate_reporting_period(
            client_year_end_month,
            client_benchmark_year,
            job_reporting_year
        )
    except (ValueError, KeyError):
        return None, None


def format_reporting_period(period_start: Optional[date], period_end: Optional[date]) -> str:
    """
    Format reporting period as human-readable string.
    
    Example:
        format_reporting_period(date(2024, 7, 1), date(2025, 6, 30))
        -> "Jul 2024 - Jun 2025"
    """
    
    if not period_start or not period_end:
        return "Not configured"
    
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    
    start_str = f"{months[period_start.month - 1]} {period_start.year}"
    end_str = f"{months[period_end.month - 1]} {period_end.year}"
    
    return f"{start_str} - {end_str}"
