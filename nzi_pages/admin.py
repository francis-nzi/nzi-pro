print("ADMIN.PY LOADED — build 2026-01-21a")
import streamlit as st
import pandas as pd

from core.database import get_conn
from core.database import db_backend
from components.tables import table_with_pager
from models import clients as m_clients
from core.auth import require_role, show_user_badge


def render():
    require_role("Admin")
    show_user_badge()

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
        st.subheader("Team access (strict provisioning)")

        with st.form("add_staff", clear_on_submit=True):
            c1, c2, c3 = st.columns(3)
            fn = c1.text_input("Full Name *")
            em = c2.text_input("Email *")
            rl = c3.selectbox("Role *", _roles())

            c4, _ = st.columns(2)
            status = c4.selectbox("Status", ["Active", "Disabled"], index=0)

            if st.form_submit_button("Add / Update"):
                em_norm = (em or "").strip().lower()
                if fn and em_norm:
                    with get_conn() as con:
                        con.execute(
                            """
                            INSERT INTO users (user_id, full_name, role, email, status)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (email) DO UPDATE SET
                                full_name = EXCLUDED.full_name,
                                role      = EXCLUDED.role,
                                status    = EXCLUDED.status,
                                user_id   = EXCLUDED.user_id
                            """,
                            [em_norm, fn.strip(), rl, em_norm, status],
                        )
                    st.success("Saved.")
                    st.rerun()
                else:
                    st.error("Full Name and Email required.")

        # --- Staff list with row actions (Edit / Archive) ---
        st.markdown("### Staff")

        if "staff_edit" not in st.session_state:
            st.session_state["staff_edit"] = None

        with get_conn() as con:
            team = con.execute(
                "SELECT full_name, email, role, status FROM users ORDER BY status DESC, role, full_name"
            ).df()

        if team.empty:
            st.info("No staff found.")
        else:
            h = st.columns([4, 4, 2, 2, 1, 1])
            h[0].markdown("**Name**")
            h[1].markdown("**Email**")
            h[2].markdown("**Role**")
            h[3].markdown("**Status**")
            h[4].markdown("**Edit**")
            h[5].markdown("**Archive**")
            st.divider()

            for _, r in team.iterrows():
                name = str(r.get("full_name") or "")
                email = str(r.get("email") or "").strip().lower()
                role = str(r.get("role") or "ReadOnly")
                status = str(r.get("status") or "Active")

                c = st.columns([4, 4, 2, 2, 1, 1])
                c[0].write(name)
                c[1].write(email)
                c[2].write(role)
                c[3].write(status)

                if c[4].button("✏️", key=f"staff_edit_{email}"):
                    st.session_state["staff_edit"] = {
                        "email": email,
                        "full_name": name,
                        "role": role,
                        "status": status,
                    }
                    st.rerun()

                if c[5].button("🗄️", key=f"staff_arch_{email}", disabled=(status == "Disabled")):
                    with get_conn() as con:
                        con.execute("UPDATE users SET status='Disabled' WHERE email=%s", [email])
                    st.toast("User disabled")
                    st.rerun()

                st.markdown(
                    "<div style='height:1px;background:rgba(120,120,120,0.15);margin:6px 0 6px 0;'></div>",
                    unsafe_allow_html=True,
                )

        # Inline edit panel
        edit = st.session_state.get("staff_edit")
        if edit:
            st.markdown("---")
            st.markdown("### Edit staff member")

            roles = _roles()
            with st.form("staff_edit_form", clear_on_submit=False):
                fn = st.text_input("Full Name", value=edit.get("full_name", ""))
                rl = st.selectbox(
                    "Role",
                    roles,
                    index=roles.index(edit["role"]) if edit.get("role") in roles else 0,
                )
                stt = st.selectbox(
                    "Status",
                    ["Active", "Disabled"],
                    index=0 if edit.get("status") == "Active" else 1,
                )
                c1, c2 = st.columns(2)
                save = c1.form_submit_button("Save")
                cancel = c2.form_submit_button("Cancel")

                if cancel:
                    st.session_state["staff_edit"] = None
                    st.rerun()

                if save:
                    with get_conn() as con:
                        con.execute(
                            """
                            UPDATE users
                            SET full_name=%s, role=%s, status=%s
                            WHERE email=%s
                            """,
                            [(fn or "").strip(), rl, stt, edit["email"]],
                        )
                    st.session_state["staff_edit"] = None
                    st.success("Saved.")
                    st.rerun()

    # =========================
    # LOOKUPS
    # =========================
    with t2:
        _ensure_quote_lookup_schema()
        l1, l2, l3, l4, l5, l6 = st.tabs([
            "Job Types",
            "VAT Rates",
            "Payment Terms",
            "Time Subjects",
            "Portfolios",
            "Industries",
        ])

        with l1:
            _job_types_editor()
        with l2:
            _vat_rates_editor()
        with l3:
            _lookup_editor(
                "payment_terms_lookup",
                ["term_id", "name", "is_active"],
                id_col="term_id",
                name_col="name",
                title="Payment Terms",
            )
        with l4:
            _lookup_editor("time_subjects", ["subject_id", "name", "is_active"], id_col="subject_id", name_col="name", title="Time Subjects")
        with l5:
            _lookup_editor("portfolios_lookup", ["portfolio_id", "name", "is_active"], id_col="portfolio_id", name_col="name", title="Portfolios")
        with l6:
            # Industries lookup (requires industries_lookup table to exist)
            _lookup_editor("industries_lookup", ["industry_id", "name", "is_active"], id_col="industry_id", name_col="name", title="Industries")

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
                        with get_conn() as con:
                            row = con.execute(
                                """
                                INSERT INTO datasets
                                (name, source, analysis_type, country, region, currency, year, version, license, notes)
                                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                                RETURNING dataset_id
                                """,
                                [
                                    name, source, analysis_type, country,
                                    region, currency, int(year),
                                    version or None, license or None, notes or None
                                ],
                            ).fetchone()
                            dsid = int(row[0])
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
            disabled_ingest = (selected_ds is None) or (file is None)
            if st.button("Ingest CSV", disabled=disabled_ingest):
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
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.dataset_id = %s AND fl.column_text ILIKE %s
                    ORDER BY fl.year DESC, fl.column_text
                    """,
                    [ds_filter, f"%{q}%"],
                ).df()
            else:
                df = con.execute(
                    """
                    SELECT fl.db_id, d.name AS dataset, d.analysis_type, d.country,
                           fl.year, fl.scope, fl.level_1, fl.level_2, fl.level_3, fl.level_4,
                           fl.column_text, fl.uom, fl.ghg_unit, fl.factor
                    FROM factor_lookup fl
                    LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                    WHERE fl.column_text ILIKE %s
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


# -------------------------
# Helpers
# -------------------------
def _roles():
    with get_conn() as con:
        df = con.execute(
            "SELECT role_name FROM roles_lookup WHERE is_active=TRUE ORDER BY role_name"
        ).df()
    rows = df["role_name"].tolist() if not df.empty else []
    if not rows:
        with get_conn() as con:
            con.execute("""
                INSERT INTO roles_lookup (role_name, is_active)
                VALUES ('Admin',TRUE),('Consultant',TRUE),('ReadOnly',TRUE),('CRM',TRUE),('QA',TRUE),('Support',TRUE)
                ON CONFLICT (role_name) DO NOTHING
            """)
        rows = ["Admin", "Consultant", "ReadOnly", "CRM", "QA", "Support"]
    return rows


def _lookup_editor(table, columns, id_col, name_col, title: str):
    st.markdown(f"### {title}")

    # Inline edit state for this lookup table
    edit_key = f"edit_{table}"
    if edit_key not in st.session_state:
        st.session_state[edit_key] = None

    try:
        with get_conn() as con:
            df = con.execute(
                f"SELECT {', '.join(columns)} FROM {table} ORDER BY {name_col}"
            ).df()
    except Exception as e:
        st.error(f"Lookup table '{table}' is not available yet. Add it in migrations. ({e})")
        return

    if df.empty:
        st.info("No rows yet.")
    else:
        h = st.columns([6, 2, 1, 1])
        h[0].markdown("**Name**")
        h[1].markdown("**Active**")
        h[2].markdown("**Edit**")
        h[3].markdown("**Archive**")

        for _, r in df.iterrows():
            rid = int(r[id_col])
            nm = str(r[name_col])
            active = bool(r.get("is_active", True))

            c = st.columns([6, 2, 1, 1])
            c[0].write(nm)
            c[1].write("Yes" if active else "No")

            if c[2].button("✏️", key=f"{table}_edit_{rid}"):
                st.session_state[edit_key] = {"id": rid, "name": nm, "active": active}
                st.rerun()

            if c[3].button("🗄️", key=f"{table}_arch_{rid}", disabled=(not active)):
                with get_conn() as con:
                    con.execute(f"UPDATE {table} SET is_active=FALSE WHERE {id_col}=%s", [rid])
                st.toast("Archived")
                st.rerun()

    # Edit panel
    edit = st.session_state.get(edit_key)
    if edit:
        st.markdown("#### Edit")
        with st.form(f"form_edit_{table}", clear_on_submit=False):
            new_name = st.text_input("Name", value=edit["name"])
            new_active = st.checkbox("Active", value=bool(edit["active"]))
            c1, c2 = st.columns(2)
            save = c1.form_submit_button("Save")
            cancel = c2.form_submit_button("Cancel")

            if cancel:
                st.session_state[edit_key] = None
                st.rerun()

            if save:
                nn = (new_name or "").strip()
                if not nn:
                    st.error("Name required.")
                else:
                    with get_conn() as con:
                        con.execute(
                            f"UPDATE {table} SET name=%s, is_active=%s WHERE {id_col}=%s",
                            [nn, bool(new_active), int(edit["id"])],
                        )
                    st.session_state[edit_key] = None
                    st.success("Saved.")
                    st.rerun()

    st.markdown("#### Add")
    with st.form(f"add_{table}", clear_on_submit=True):
        nm = st.text_input("Name")
        active = st.checkbox("Active", value=True)
        if st.form_submit_button("Add"):
            nn = (nm or "").strip()
            if not nn:
                st.error("Name required.")
            else:
                with get_conn() as con:
                    new_id = int(con.execute(f"SELECT COALESCE(MAX({id_col}),0)+1 FROM {table}").fetchone()[0])
                    con.execute(
                        f"INSERT INTO {table} ({id_col}, name, is_active) VALUES (%s,%s,%s)",
                        [new_id, nn, bool(active)],
                    )
                st.success("Added.")
                st.rerun()


def _ensure_quote_lookup_schema():
    try:
        with get_conn() as con:
            if db_backend() == "postgres":
                con.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vat_rates_lookup (
                      vat_rate_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                      name TEXT NOT NULL,
                      rate_pct NUMERIC NOT NULL,
                      is_default BOOLEAN NOT NULL DEFAULT FALSE,
                      is_active BOOLEAN NOT NULL DEFAULT TRUE
                    )
                    """
                )
                con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS description TEXT")
                con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS unit_price_ex_vat NUMERIC")
                con.execute("ALTER TABLE job_types ADD COLUMN IF NOT EXISTS vat_rate_id INTEGER")

                con.execute(
                    """
                    INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                    SELECT '20% Standard Rate', 20, TRUE, TRUE
                    WHERE NOT EXISTS (
                      SELECT 1 FROM vat_rates_lookup WHERE lower(name)=lower('20% Standard Rate')
                    )
                    """
                )
                con.execute(
                    """
                    INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                    SELECT 'No VAT', 0, FALSE, TRUE
                    WHERE NOT EXISTS (
                      SELECT 1 FROM vat_rates_lookup WHERE lower(name)=lower('No VAT')
                    )
                    """
                )
        return True
    except Exception as e:
        st.warning(f"Quote lookup schema ensure failed (db_backend={db_backend()}): {e}")
        return False


def _vat_rates_editor():
    st.markdown("### VAT Rates")

    _ensure_quote_lookup_schema()

    edit_key = "edit_vat_rates_lookup"
    if edit_key not in st.session_state:
        st.session_state[edit_key] = None

    try:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT vat_rate_id, name, rate_pct, is_default, is_active
                FROM vat_rates_lookup
                ORDER BY is_default DESC, name
                """
            ).df()
    except Exception as e:
        st.error(
            "VAT Rates table is not available yet. "
            "Apply sql_migrations/0003_quotes_lookups.sql to your Postgres DB. "
            f"({e})"
        )
        return

    if df.empty:
        st.info("No rows yet.")
    else:
        h = st.columns([4, 2, 2, 2, 1])
        h[0].markdown("**Name**")
        h[1].markdown("**Rate %**")
        h[2].markdown("**Default**")
        h[3].markdown("**Active**")
        h[4].markdown("**Edit**")

        for _, r in df.iterrows():
            rid = int(r["vat_rate_id"])
            c = st.columns([4, 2, 2, 2, 1])
            c[0].write(str(r.get("name") or ""))
            c[1].write(str(r.get("rate_pct") or ""))
            c[2].write("Yes" if bool(r.get("is_default")) else "No")
            c[3].write("Yes" if bool(r.get("is_active", True)) else "No")
            if c[4].button("✏️", key=f"vat_edit_{rid}"):
                st.session_state[edit_key] = {
                    "id": rid,
                    "name": str(r.get("name") or ""),
                    "rate_pct": float(r.get("rate_pct") or 0),
                    "is_default": bool(r.get("is_default")),
                    "is_active": bool(r.get("is_active", True)),
                }
                st.rerun()

    edit = st.session_state.get(edit_key)
    if edit:
        st.markdown("#### Edit")
        with st.form("form_edit_vat_rates", clear_on_submit=False):
            name = st.text_input("Name", value=edit.get("name", ""))
            rate_pct = st.number_input("Rate %", min_value=0.0, max_value=100.0, value=float(edit.get("rate_pct", 0.0)))
            is_default = st.checkbox("Default", value=bool(edit.get("is_default")))
            is_active = st.checkbox("Active", value=bool(edit.get("is_active", True)))
            c1, c2 = st.columns(2)
            save = c1.form_submit_button("Save")
            cancel = c2.form_submit_button("Cancel")

            if cancel:
                st.session_state[edit_key] = None
                st.rerun()

            if save:
                nn = (name or "").strip()
                if not nn:
                    st.error("Name required.")
                else:
                    with get_conn() as con:
                        if is_default:
                            con.execute("UPDATE vat_rates_lookup SET is_default=FALSE")
                        con.execute(
                            """
                            UPDATE vat_rates_lookup
                            SET name=%s, rate_pct=%s, is_default=%s, is_active=%s
                            WHERE vat_rate_id=%s
                            """,
                            [nn, float(rate_pct), bool(is_default), bool(is_active), int(edit["id"])],
                        )
                    st.session_state[edit_key] = None
                    st.success("Saved.")
                    st.rerun()

    st.markdown("#### Add")
    with st.form("add_vat_rate", clear_on_submit=True):
        name = st.text_input("Name", key="vat_add_name")
        rate_pct = st.number_input("Rate %", min_value=0.0, max_value=100.0, value=20.0, key="vat_add_rate")
        is_default = st.checkbox("Default", value=False, key="vat_add_default")
        is_active = st.checkbox("Active", value=True, key="vat_add_active")
        if st.form_submit_button("Add"):
            nn = (name or "").strip()
            if not nn:
                st.error("Name required.")
            else:
                with get_conn() as con:
                    if is_default:
                        con.execute("UPDATE vat_rates_lookup SET is_default=FALSE")
                    con.execute(
                        """
                        INSERT INTO vat_rates_lookup (name, rate_pct, is_default, is_active)
                        VALUES (%s,%s,%s,%s)
                        """,
                        [nn, float(rate_pct), bool(is_default), bool(is_active)],
                    )
                st.success("Added.")
                st.rerun()


def _job_types_editor():
    st.markdown("### Job Types")

    _ensure_quote_lookup_schema()

    edit_key = "edit_job_types"
    if edit_key not in st.session_state:
        st.session_state[edit_key] = None

    try:
        with get_conn() as con:
            jdf = con.execute(
                """
                SELECT job_type_id, name, description, unit_price_ex_vat, vat_rate_id, is_active
                FROM job_types
                ORDER BY is_active DESC, name
                """
            ).df()
            vdf = con.execute(
                """
                SELECT vat_rate_id, name, rate_pct, is_default
                FROM vat_rates_lookup
                WHERE is_active=TRUE
                ORDER BY is_default DESC, name
                """
            ).df()
    except Exception as e:
        try:
            with get_conn() as con:
                jdf = con.execute(
                    """
                    SELECT job_type_id, name, is_active
                    FROM job_types
                    ORDER BY is_active DESC, name
                    """
                ).df()
            st.error(
                "Job Types pricing/VAT columns are not available yet. "
                "Apply sql_migrations/0003_quotes_lookups.sql to your Postgres DB."
            )
            table_with_pager(jdf, "Job Types (basic)", key="job_types_basic")
        except Exception as e2:
            st.error(
                "Job Types/VAT lookup tables are not available yet. "
                "Apply sql_migrations/0003_quotes_lookups.sql to your Postgres DB. "
                f"({e}; {e2})"
            )
        return

    vat_options = []
    vat_map = {}
    if not vdf.empty:
        for _, r in vdf.iterrows():
            vid = int(r["vat_rate_id"])
            label = f"{r.get('name')} ({float(r.get('rate_pct') or 0):g}%)"
            vat_options.append(label)
            vat_map[label] = vid

    def _vat_label_for_id(vat_rate_id):
        if vat_rate_id is None or vdf.empty:
            return None
        try:
            vid = int(vat_rate_id)
        except Exception:
            return None
        rows = vdf.loc[vdf["vat_rate_id"] == vid]
        if rows.empty:
            return None
        rr = rows.iloc[0]
        return f"{rr.get('name')} ({float(rr.get('rate_pct') or 0):g}%)"

    if jdf.empty:
        st.info("No rows yet.")
    else:
        h = st.columns([3, 4, 2, 2, 2, 1])
        h[0].markdown("**Name**")
        h[1].markdown("**Description**")
        h[2].markdown("**Unit Price (ex VAT)**")
        h[3].markdown("**VAT**")
        h[4].markdown("**Active**")
        h[5].markdown("**Edit**")

        for _, r in jdf.iterrows():
            rid = int(r["job_type_id"])
            c = st.columns([3, 4, 2, 2, 2, 1])
            c[0].write(str(r.get("name") or ""))
            c[1].write(str(r.get("description") or ""))
            c[2].write(str(r.get("unit_price_ex_vat") or ""))
            c[3].write(_vat_label_for_id(r.get("vat_rate_id")) or "")
            c[4].write("Yes" if bool(r.get("is_active", True)) else "No")
            if c[5].button("✏️", key=f"jt_edit_{rid}"):
                st.session_state[edit_key] = {
                    "id": rid,
                    "name": str(r.get("name") or ""),
                    "description": str(r.get("description") or ""),
                    "unit_price_ex_vat": float(r.get("unit_price_ex_vat") or 0),
                    "vat_rate_id": (None if pd.isna(r.get("vat_rate_id")) else r.get("vat_rate_id")),
                    "is_active": bool(r.get("is_active", True)),
                }
                st.rerun()

    edit = st.session_state.get(edit_key)
    if edit:
        st.markdown("#### Edit")
        with st.form("form_edit_job_type", clear_on_submit=False):
            name = st.text_input("Name", value=edit.get("name", ""))
            desc = st.text_area("Description", value=edit.get("description", ""), height=80)
            unit_price = st.number_input("Unit Price (ex VAT)", min_value=0.0, value=float(edit.get("unit_price_ex_vat", 0.0)))
            vat_default_label = _vat_label_for_id(edit.get("vat_rate_id"))
            if vat_options:
                vat_idx = vat_options.index(vat_default_label) if vat_default_label in vat_options else 0
                vat_label = st.selectbox("VAT Rate", vat_options, index=vat_idx)
                vat_rate_id = vat_map.get(vat_label)
            else:
                vat_rate_id = None
                st.info("Add VAT Rates first to select VAT for job types.")
            is_active = st.checkbox("Active", value=bool(edit.get("is_active", True)))
            c1, c2 = st.columns(2)
            save = c1.form_submit_button("Save")
            cancel = c2.form_submit_button("Cancel")

            if cancel:
                st.session_state[edit_key] = None
                st.rerun()

            if save:
                nn = (name or "").strip()
                if not nn:
                    st.error("Name required.")
                else:
                    with get_conn() as con:
                        con.execute(
                            """
                            UPDATE job_types
                            SET name=%s,
                                description=%s,
                                unit_price_ex_vat=%s,
                                vat_rate_id=%s,
                                is_active=%s
                            WHERE job_type_id=%s
                            """,
                            [
                                nn,
                                (desc or None),
                                float(unit_price),
                                (int(vat_rate_id) if vat_rate_id is not None else None),
                                bool(is_active),
                                int(edit["id"]),
                            ],
                        )
                    st.session_state[edit_key] = None
                    st.success("Saved.")
                    st.rerun()

    st.markdown("#### Add")
    with st.form("add_job_type", clear_on_submit=True):
        name = st.text_input("Name", key="jt_add_name")
        desc = st.text_area("Description", value="", height=80, key="jt_add_desc")
        unit_price = st.number_input("Unit Price (ex VAT)", min_value=0.0, value=0.0, key="jt_add_price")
        if vat_options:
            vat_label = st.selectbox("VAT Rate", vat_options, index=0, key="jt_add_vat")
            vat_rate_id = vat_map.get(vat_label)
        else:
            vat_rate_id = None
            st.info("Add VAT Rates first to select VAT for job types.")
        is_active = st.checkbox("Active", value=True, key="jt_add_active")
        if st.form_submit_button("Add"):
            nn = (name or "").strip()
            if not nn:
                st.error("Name required.")
            else:
                with get_conn() as con:
                    con.execute(
                        """
                        INSERT INTO job_types (name, description, unit_price_ex_vat, vat_rate_id, is_active)
                        VALUES (%s,%s,%s,%s,%s)
                        """,
                        [
                            nn,
                            (desc or None),
                            float(unit_price),
                            (int(vat_rate_id) if vat_rate_id is not None else None),
                            bool(is_active),
                        ],
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
    """
    Ingest factors CSV into factor_lookup.
    Supports DESNZ 2025+ format with:
      - Year column (optional, overrides dataset year)
      - Level 4 column (optional)
      - GHG Unit column (defaults to kgCO2e)
    Backwards compatible with older samples.
    """
    import io
    import numpy as np

    def norm_col(c: str) -> str:
        return c.lower().strip().replace("_", " ")

    def norm_ghg_unit(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return "kgCO2e"
        s = str(v).strip()
        if not s or s.lower() == "nan":
            return "kgCO2e"
        s = s.replace(" ", "")
        if s.lower() in ("kgco2e", "kgco₂e"):
            return "kgCO2e"
        return s

    # Read CSV
    content = file.read()
    # Read CSV bytes with robust encoding fallback (DESNZ files are sometimes Windows-1252)
    try:
        df = pd.read_csv(io.BytesIO(content), encoding="utf-8")
    except UnicodeDecodeError:
        try:
            df = pd.read_csv(io.BytesIO(content), encoding="cp1252")
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(content), encoding="latin1")

    # Column map (case / underscore / spacing tolerant)
    cols = {norm_col(c): c for c in df.columns}

    def pick(*names):
        for n in names:
            k = norm_col(n)
            if k in cols:
                return cols[k]
        return None

    # Core columns
    c_year = pick("Year")
    c_id = pick("ID", "Code")
    c_scope = pick("Scope")
    c_l1 = pick("Level 1", "Category", "SIC Section", "Product Group")
    c_l2 = pick("Level 2", "Subcategory", "SIC Division", "Product")
    c_l3 = pick("Level 3", "Detail", "Item")
    c_l4 = pick("Level 4")
    c_text = pick("Column Text", "Description", "Name", "Activity")
    c_uom = pick("UOM", "Unit", "Units")
    c_ghg = pick("GHG Unit", "GHGUnit")
    c_fac = pick(
        "Factor",
        "GHG Conversion Factor",
        "kgCO2e per unit",
        "kgco2e_per_unit",
        "kgCO2e per GBP",
        "kgCO2e_per_GBP",
    )

    if c_text is None or c_fac is None:
        st.error("CSV missing required columns (Column Text / Factor).")
        return 0

    # Dataset metadata fallback
    meta = datasets_df.loc[datasets_df["dataset_id"] == dataset_id].iloc[0]
    ds_year = int(meta["year"])
    src = str(meta["source"])
    region = str(meta.get("region", "") or "")
    currency = str(meta.get("currency", "GBP") or "GBP")

    rows = []

    for _, r in df.iterrows():
        # Year precedence: CSV > dataset
        yr = None
        if c_year and not pd.isna(r[c_year]):
            try:
                yr = int(r[c_year])
            except Exception:
                yr = ds_year
        else:
            yr = ds_year

        # Factor (skip invalid)
        try:
            factor = float(r[c_fac])
        except Exception:
            continue

        rows.append(
            [
                dataset_id,
                file.name,
                yr,
                r[c_id] if c_id else None,
                r[c_scope] if c_scope else None,
                r[c_l1] if c_l1 else None,
                r[c_l2] if c_l2 else None,
                r[c_l3] if c_l3 else None,
                r[c_l4] if c_l4 else None,
                str(r[c_text]).strip(),
                r[c_uom] if c_uom else None,
                norm_ghg_unit(r[c_ghg]) if c_ghg else "kgCO2e",
                factor,
                src,
                region,
                currency,
            ]
        )

    if not rows:
        st.warning("No valid factor rows found.")
        return 0

    with get_conn() as con:
        sql = """
            INSERT INTO factor_lookup
            (
              dataset_id,
              file_name,
              year,
              original_id,
              scope,
              level_1,
              level_2,
              level_3,
              level_4,
              column_text,
              uom,
              ghg_unit,
              factor,
              source,
              region,
              currency
            )
            VALUES
            (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """
        for params in rows:
            con.execute(sql, params)

    return len(rows)
