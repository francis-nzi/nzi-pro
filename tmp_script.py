from core.database import get_conn

def main():
    with get_conn() as con:
        print("== client_sites ==")
        print(con.execute("PRAGMA table_info('client_sites')").df().to_string(index=False))
        print("\n== activity_data ==")
        print(con.execute("PRAGMA table_info('activity_data')").df().to_string(index=False))
        print("\n== client_contacts ==")
        print(con.execute("PRAGMA table_info('client_contacts')").df().to_string(index=False))

if __name__ == "__main__":
    main()
