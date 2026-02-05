from core.database import get_conn

try:
    with get_conn() as con:
        df = con.execute('SELECT * FROM job_types ORDER BY name').df()
        print(f'Success: {len(df)} rows')
        print(df.to_dict('records'))
except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
