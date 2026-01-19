import streamlit as st
import pandas as pd
from core.database import get_conn, next_id
from components.tables import table_with_pager
from models import clients as m_clients


def render():
    st.title("⚙️ Admin Center")

    t1, t2, t3, t4 = st.tabs([
        "👥 NZI Team",
        "📋 Lookups",
        "📚 Datasets & Factors",
        "🗄️ Archived Clients",
    ])

    # =========================
    # NZI TEAM
    # =========================
    with t1:
        with st.form("add_staff", clear_on_submit=True):
            c1, c2, c3 = st.columns(3)
            fn = c1.text_input("Full Name *")
            em = c2.text_input("Email *")
            rl = c3.selectbox("Role *", _roles())
            if st.form_submit_button("Add / Update"):
                if fn and em:
                    with get_conn() as con:
                        con.execute(
                            """
                            INSERT OR REPLACE INTO users
                            (user_id, full_name, role, email, status)
                            VALUES (?,?,?,?,COALESCE(
                                (SELECT status FROM users WHERE user_id=?),'Active'))
                            """,
                            [em, fn, rl, em, em],
                        )
                    st.success("Saved.")
                    st.rerun()
                else:
                    st.error("Full Name and Email required.")

        with get_conn() as con:
            team = con.execute(
                "SELECT full_name, email, role, status FROM users ORDER BY status DESC, full_name"
            ).df()
        table_with_pager(team, "Staff", key="staff")

    # =========================
    # LOOKUPS
    # =========================
    with t2:
        l1, l2, l3 = st.tabs(["Job Types", "Time Subjects", "Portfolios"])
        with l1:
            _lookup_editor("job_types", ["job_type_id", "name", "is_active"], id_col="job_type_id", name_col="name")
        with l2:
            _lookup_editor("time_subjects", ["subject_id", "name", "is_active"], id_col="subject_id", name_col="name")
        with l3:
            _lookup_editor("portfolios_lookup", ["portfolio_id", "name", "is_active"], id_col="portfolio_id", name_col="name")

    # =========================
    # DATASETS & FACTORS
    # =========================
    with t3:
        st.subheader("Dataset Registry & Import")
        left, right = st.columns(2)

        with left:
            with st.form("new_dataset", clear_on_submit=True):
                name = st.text_input("Dataset Name *", placeholder="DESNZ Activity UK 2025")
                source = st.text_input("Source *", placeholder="DESNZ / DEFRA / SWC / Custom")
                analysis_type = st.selectbox("Analysis Type *", ["Activity", "Spend", "Custom"], index=0)
                country = st.text_input("Country *", value="UK")
                region = st.text_input("Region", value="")
                currency = st.text_input("Currency", value="GBP")
                year = st.number_input("Year *", min_value=1900, max_value=2100, value=2025)
                version = st.text_input("Version", value="v1")
                license = st.text_input("License", value="")
                notes = st.text_area("Notes", value="")

                if st.form_submit_button("Create Dataset"):
                    if not name or not source:
                        st.error("Name and Source are required.")
                    else:
                        dsid = next_id("datasets", "dataset_id")
                        with get_conn() as con:
                            con.execute(
                                """
                                INSERT INTO datasets
                                (dataset_id, name, source, analysis_type, country, region, currency, year, version, license, notes)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                                """,
                                [
                                    dsid, name, source, analysis_type, country,
                                    region, currency, int(year),
                                    version or None, license or None, notes or None
                                ],
                            )
                        st.success(f"Dataset created with ID {dsid}.")
                        st.rerun()

        with right:
            with get_conn() as con:
                ddf = con.execute(
                    "SELECT dataset_id, name, source, analysis_type, country, year, version FROM datasets ORDER BY year DESC, name"
                ).df()

            if ddf.empty:
                st.warning("Create a dataset first.")
                selected_ds = None
            else:
                display = ddf.apply(
                    lambda r: f"[{int(r['dataset_id'])}] {r['name']} — {r['source']} — "
                              f"{r['analysis_type']} — {r['country']} {int(r['year'])} ({r['version'] or 'v1'})",
                    axis=1,
                ).tolist()
                choice = st.selectbox("Dataset", display)
                selected_ds = int(choice.split("]")[0].strip("[")) if choice else None

            file = st.file_uploader("Upload Factors CSV", type=["csv"], key="fac_csv")
            if st.button("Ingest CSV", disabled=(selected_ds is None)):
                if not file:
                    st.error("Upload a CSV first.")
                else:
                    count = _ingest_factors(file, selected_ds, ddf)
                    st.success(f"Ingested {count} rows into dataset {selected_ds}.")
                    st.rerun()

        st.markdown("---")
        st.markdown("**Download sample CSVs**")
        s1, s2, s3, s4 = st.columns(4)
        with s1: _dl_sample("DESNZ Activity", "assets/samples/DESNZ_Activity_SAMPLE.csv")
        with s2: _dl_sample("DEFRA Spend (SIC)", "assets/samples/DEFRA_Spend_SIC_SAMPLE.csv")
        with s3: _dl_sample("DEFRA Spend (Product)", "assets/samples/DEFRA_Spend_Product_SAMPLE.csv")
        with s4: _dl_sample("Custom Generic", "assets/samples/CUSTOM_Generic_SAMPLE.csv")

        st.markdown("---")
        st.subheader("Search Factors")
        qcol1, qcol2 = st.columns([2, 1])
        q = qcol1.text_input("Search text", value="")
        ds_filter = None

        with get_conn() as con:
            dlist = con.execute("SELECT dataset_id, name, year FROM datasets ORDER BY year DESC, name").df()

        if not dlist.empty:
            disp = ["All datasets"] + dlist.apply(
                lambda r: f"[{int(r['dataset_id'])}] {r['name']} {int(r['year'])}", axis=1
            ).tolist()
            pick = qcol2.selectbox("Dataset", disp, index=0)
            if pick != "All datasets":
                ds_filter = int(pick.split("]")[0].strip("["))

        with get_conn() as con:
            if ds_filter:
                df = con.execute(
                    """
                    SELECT fl.db_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3,
                           fl.column_text, fl.uom, fl.factor
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.dataset_id = ? AND fl.column_text ILIKE ?
                    ORDER BY fl.year DESC, fl.column_text
                    """,
                    [ds_filter, f"%{q}%"],
                ).df()
            else:
                df = con.execute(
                    """
                    SELECT fl.db_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3,
                           fl.column_text, fl.uom, fl.factor
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.column_text ILIKE ?
                    ORDER BY fl.year DESC, fl.column_text
                    """,
                    [f"%{q}%"],
                ).df()

        table_with_pager(df, "Factors", key="factors_tbl")

    # =========================
    # ARCHIVED CLIENTS
    # =========================
    with t4:
        st.subheader("Archived Clients")

        q = st.text_input("Search archived clients", key="archived_clients_search")
        df = m_clients.list_archived_clients(q)
        table_with_pager(df, "Archived Clients", key="archived_clients_tbl")

        if df.empty:
            st.info("No archived clients.")
            return

        options = {
            f"{r['client_name']} (ID {int(r['db_id'])})": int(r["db_id"])
            for _, r in df.iterrows()
        }
        label = st.selectbox("Select archived client to reactivate", list(options.keys()))
        cid = options[label]

        if st.button("Reactivate client"):
            m_clients.reactivate_client(cid)
            st.success("Client reactivated.")
            st.rerun()


# =========================
# HELPERS
# =========================
def _roles():
    with get_conn() as con:
        rows = con.execute(
            "SELECT role_name FROM roles_lookup WHERE is_active=TRUE ORDER BY role_name"
        ).df()["role_name"].tolist()
    if not rows:
        with get_conn() as con:
            con.execute("INSERT INTO roles_lookup VALUES ('Admin',TRUE),('CRM',TRUE),('Auditor',TRUE)")
        rows = ["Admin", "CRM", "Auditor"]
    return rows


def _lookup_editor(table, columns, id_col, name_col):
    with get_conn() as con:
        df = con.execute(
            f"SELECT {', '.join(columns)} FROM {table} ORDER BY {name_col}"
        ).df()
    table_with_pager(df, table.replace("_", " ").title(), key=f"{table}_tbl")

    with st.form(f"add_{table}", clear_on_submit=True):
        nm = st.text_input("Name")
        active = st.checkbox("Active", value=True)
        if st.form_submit_button("Add"):
            if not nm:
                st.error("Name required.")
            else:
                with get_conn() as con:
                    new_id = int(
                        con.execute(
                            f"SELECT COALESCE(MAX({id_col}),0)+1 FROM {table}"
                        ).fetchone()[0]
                    )
                    con.execute(
                        f"INSERT INTO {table} ({id_col}, name, is_active) VALUES (?,?,?)",
                        [new_id, nm, active],
                    )
                st.success("Added.")
                st.rerun()


def _dl_sample(label, path):
    try:
        with open(path, "rb") as f:
            data = f.read()
        st.download_button(
            f"Download {label} CSV",
            data,
            file_name=path.split("/")[-1],
            mime="text/csv",
        )
    except Exception:
        st.warning(f"Missing sample file {path}")


def _ingest_factors(file, dataset_id: int, datasets_df: pd.DataFrame) -> int:
    import io

    content = file.read()
    df = pd.read_csv(io.BytesIO(content))
    cols = {c.lower().strip(): c for c in df.columns}

    def pick(*names):
        for n in names:
            if n.lower() in cols:
                return cols[n.lower()]
        return None

    id_col = pick("ID", "Code", "id", "code")
    scope = pick("Scope")
    l1 = pick("Level 1", "level_1", "Category", "SIC Section", "Product Group")
    l2 = pick("Level 2", "level_2", "Subcategory", "SIC Division", "Product")
    l3 = pick("Level 3", "level_3", "Detail", "Item")
    text = pick("Column Text", "column_text", "Description", "Name", "Item Name", "Activity")
    uom = pick("UOM", "Unit", "Units")
    fac = pick(
        "Factor",
        "GHG Conversion Factor",
        "kgCO2e per unit",
        "kgco2e_per_unit",
        "kgCO2e per GBP",
        "kgCO2e_per_GBP",
    )

    if text is None or fac is None:
        st.error("CSV missing required columns. See samples above.")
        return 0

    meta = datasets_df.loc[datasets_df["dataset_id"] == dataset_id].iloc[0]
    src = str(meta["source"])
    region = str(meta.get("region", "") or "")
    currency = str(meta.get("currency", "GBP") or "GBP")
    year = int(meta["year"])

    rows = []
    for _, r in df.iterrows():
        rows.append([
            dataset_id, file.name, year,
            getattr(r, id_col) if id_col else None,
            getattr(r, scope) if scope else None,
            getattr(r, l1) if l1 else None,
            getattr(r, l2) if l2 else None,
            getattr(r, l3) if l3 else None,
            str(getattr(r, text)),
            getattr(r, uom) if (isinstance(uom, str) and uom in df.columns) else None,
            float(getattr(r, fac)),
            src, region, currency,
        ])

    with get_conn() as con:
        con.executemany(
            """
            INSERT INTO factor_lookup
            (dataset_id, file_name, year, original_id, scope,
             level_1, level_2, level_3, column_text, uom, factor,
             source, region, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            rows,
        )
    return len(rows)
