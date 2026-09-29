"""Read-only audit of CRM scope rows omitted by register-only portal tabs."""
import json
import os
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv
import psycopg


def main():
    load_dotenv(Path.cwd() / ".env")
    with psycopg.connect(os.environ["DATABASE_URL"], options="-c default_transaction_read_only=on") as con:
        with con.cursor() as cur:
            cur.execute("""
                WITH current_jobs AS (
                    SELECT DISTINCT ON (client_db_id) client_db_id, job_id
                    FROM jobs WHERE COALESCE(portal_visible, TRUE) = TRUE
                      AND LOWER(COALESCE(status, '')) NOT LIKE '%%closed%%'
                    ORDER BY client_db_id, reporting_year DESC NULLS LAST, job_id DESC
                )
                SELECT j.job_id, j.job_number, j.client_db_id, c.client_name,
                       j.reporting_year, j.status, j.portal_visible,
                       (cj.job_id = j.job_id) AS current_portal_job,
                       b.bucket_key, COUNT(*) AS missing_rows,
                       COUNT(*) FILTER (WHERE COALESCE(r.qty, 0) <> 0) AS rows_with_quantity,
                       array_agg(r.row_id ORDER BY r.row_id) AS row_ids
                FROM job_scope_rows r JOIN jobs j ON j.job_id = r.job_id
                JOIN clients c ON c.db_id = j.client_db_id
                JOIN portal_data_entry_buckets b ON b.match_category = TRIM(r.category)
                LEFT JOIN current_jobs cj ON cj.client_db_id = j.client_db_id
                WHERE b.bucket_key IN ('business_travel', 'company_vehicles')
                  AND (r.enabled = TRUE OR r.review_status IN ('pending_review', 'rejected'))
                GROUP BY j.job_id, j.job_number, j.client_db_id, c.client_name,
                         j.reporting_year, j.status, j.portal_visible, cj.job_id, b.bucket_key
                ORDER BY current_portal_job DESC NULLS LAST, j.job_id, b.bucket_key
            """)
            names = [col.name for col in cur.description]
            rows = [dict(zip(names, row)) for row in cur.fetchall()]
    active = [r for r in rows if r['current_portal_job']]
    summary = {
        'all_jobs': len({r['job_id'] for r in rows}),
        'all_rows': sum(r['missing_rows'] for r in rows),
        'current_portal_jobs': len({r['job_id'] for r in active}),
        'current_portal_rows': sum(r['missing_rows'] for r in active),
        'current_rows_with_quantity': sum(r['rows_with_quantity'] for r in active),
        'current_by_bucket': {b: sum(r['missing_rows'] for r in active if r['bucket_key'] == b)
                              for b in ['business_travel', 'company_vehicles']},
    }
    output = Path('portal_visibility_audit.json')
    output.write_text(json.dumps({'summary': summary, 'jobs': rows}, indent=2, default=str))
    print(json.dumps(summary))
    print('Job 487:', json.dumps([r for r in rows if r['job_id'] == 487], default=str))


if __name__ == '__main__':
    main()
