import streamlit as st
import plotly.express as px
import pandas as pd

from models.clients import get_client, update_client, list_crm_owners, list_portfolios
from components.tables import table_with_pager
from core.database import get_conn
from utils.forecasting import build_forecast_df

# Phase 1 service extraction (MCP-ready): keep DB ops out of Streamlit pages
from services.sites import add_site, list_sites
from services.contacts import add_contact, list_contacts
from services.notes import add_note, list_notes


def is_blank(x) -> bool:
    # Handles None, "", pandas.NA, NaN
    try:
        if pd.isna(x):
            return True
    except Exception:
        pass
    return x is None or (isinstance(x, str) and x.strip() == "")


def coalesce(x, default):
    return default if is_blank(x) else x


def _goto_clients():
    st.session_state["active_page"] = "Clients"
    st.session_state["edit_mode"] = False
    if "nav_page" in st.session_state:
        st.session_state["nav_page"] = "Clients"
    # no st.rerun() here (callbacks auto-rerun)


def _start_edit():
    st.session_state["edit_mode"] = True
    # no st.rerun() here


def _stop_edit():
    st.session_state["edit_mode"] = False
    # no st.rerun() here


def render():
    cid = st.session_state.get("selected_client_id")
    if is_blank(cid):
        st.info("Select a client from the Clients page.")
        return

    c = get_client(cid)
    if c is None:
        st.error("Client not found.")
        return

    st.title(f"📂 {c['client_name']}")
    st.caption(
        f"HQ: {coalesce(c.get('headquarters'), '-')}  |  Reg: {coalesce(c.get('company_reg'), '-')}"
    )

    # Header action bar: deterministic Back + Edit controls.
    h1, h2, h3 = st.columns([2, 2, 6])
    with h1:
        st.button("← Back to Clients", key="cf_back_to_clients", on_click=_goto_clients)
    with h2:
        if st.session_state.get("edit_mode"):
            st.button("✓ Done Editing", key="cf_done_edit", on_click=_stop_edit)
        else:
            st.button("✏️ Edit Client", key="cf_start_edit", on_click=_start_edit)
    st.markdown("---")

    # Client profile edit mode (can be entered from Clients or from here).
    if st.session_state.get("edit_mode"):
        with st.expander("✏️ Edit Client Profile", expanded=True):
            with st.form("edit_client_form"):
                r1, r2, r3 = st.columns(3)

                crm_opts = list_crm_owners()
                crm_default = coalesce(c.get("crm_owner"), "(Unassigned)")
                crm_idx = crm_opts.index(crm_default) if crm_default in crm_opts else 0
                crm_owner = r1.selectbox("CRM Owner", crm_opts, index=crm_idx)

                portfolio_opts = list_portfolios()
                port_default = coalesce(c.get("portfolio"), "NZI")
                port_idx = portfolio_opts.index(port_default) if port_default in portfolio_opts else 0
                portfolio = r2.selectbox("Portfolio", portfolio_opts, index=port_idx)

                months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                ym_default = coalesce(c.get("year_end_month"), "")
                ym_idx = months.index(ym_default) if ym_default in months else 0
                year_end_month = r3.selectbox("Financial Year End (Month)", months, index=ym_idx)

                c1, c2 = st.columns(2)
                client_name = c1.text_input("Client Name", value=coalesce(c.get("client_name"), ""))
                website = c2.text_input("Website", value=coalesce(c.get("website"), ""))

                d1, d2 = st.columns(2)
                industry = d1.text_input("Industry", value=coalesce(c.get("industry"), ""))
                company_reg = d2.text_input("Company Reg", value=coalesce(c.get("company_reg"), ""))

                e1, e2 = st.columns(2)
                headquarters = e1.text_input("Headquarters", value=coalesce(c.get("headquarters"), ""))
                logo_url = e2.text_input("Logo URL", value=coalesce(c.get("logo_url"), ""))

                desc = st.text_area(
                    "Company Description (Long)",
                    value=coalesce(c.get("description_long"), ""),
                    height=120,
                )

                b1, b2 = st.columns(2)
                save = b1.form_submit_button("Save Profile")
                cancel = b2.form_submit_button("Cancel")

                if cancel:
                    _stop_edit()

                if save:
                    if is_blank(client_name):
                        st.error("Client Name is required.")
                    else:
                        payload = {
                            "client_name": client_name,
                            "website": website or None,
                            "industry": industry or None,
                            "company_reg": company_reg or None,
                            "headquarters": headquarters or None,
                            "logo_url": logo_url or None,
                            "description_long": desc or None,
                            "crm_owner": (None if crm_owner == "(Unassigned)" else crm_owner),
                            "portfolio": portfolio or "NZI",
                            "year_end_month": (year_end_month or None),
                        }
                        update_client(int(cid), payload)
                        st.success("Client profile updated.")
                        _stop_edit()

    tabs = st.tabs(["🏢 Sites", "📞 Contacts", "🧵 Jobs", "📄 CRP", "🎯 Targets", "🧾 Activity", "🧪 Datasets Used", "📝 Notes"])

    # --------------------
    # SITES (ADD + LIST)
    # --------------------
    with tabs[0]:
        with st.expander("➕ Add Site", expanded=False):
            with st.form("add_site_form", clear_on_submit=True):
                s1, s2 = st.columns(2)
                site_name = s1.text_input("Site Name *")
                location = s2.text_input("Location")
                is_reg = st.checkbox("Registered Office", value=False)

                if st.form_submit_button("Add Site"):
                    if is_blank(site_name):
                        st.error("Site Name is required.")
                    else:
                        add_site(int(cid), site_name, (location or None), bool(is_reg))
                        st.success("Site added.")
                        st.rerun()

        df = list_sites(int(cid))
        table_with_pager(df, "Sites", key="sites")

    # -----------------------
    # CONTACTS (ADD + LIST)
    # -----------------------
    with tabs[1]:
        with st.expander("➕ Add Contact", expanded=False):
            with st.form("add_contact_form", clear_on_submit=True):
                c1, c2, c3 = st.columns(3)
                full_name = c1.text_input("Full Name *")
                job_title = c2.text_input("Job Title")
                email = c3.text_input("Email")

                if st.form_submit_button("Add Contact"):
                    if is_blank(full_name):
                        st.error("Full Name is required.")
                    else:
                        add_contact(int(cid), full_name, (job_title or None), (email or None))
                        st.success("Contact added.")
                        st.rerun()

        df = list_contacts(int(cid))
        table_with_pager(df, "Contacts", key="contacts")

    # --------------------
    # JOBS (LIST)
    # --------------------
    with tabs[2]:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT job_number, job_type, title, reporting_year, status, start_date, due_date
                FROM jobs
                WHERE client_db_id=?
                ORDER BY created_at DESC
                """,
                [cid]
            ).df()
        table_with_pager(df, "Client Jobs", key="client_jobs")

    # --------------------
    # CRP (LIST)
    # --------------------
    with tabs[3]:
        with get_conn() as con:
            df = con.execute(
                "SELECT reporting_year, is_benchmark, status, created_at FROM crp_reports WHERE client_db_id=? ORDER BY reporting_year",
                [cid]
            ).df()
        table_with_pager(df, "CRP Years", key="crp_years")

    # --------------------
    # TARGETS (EDIT + CHART)
    # --------------------
    with tabs[4]:
        st.subheader("Net Zero Targets")
        nz_col, it_col = st.columns(2)
        nz_year = nz_col.number_input(
            "Net Zero Year",
            min_value=2025,
            max_value=2100,
            value=int(coalesce(c.get("net_zero_year"), 2050)),
        )
        interim_year = it_col.number_input(
            "Interim Year",
            min_value=2025,
            max_value=2100,
            value=int(coalesce(c.get("interim_year"), 2035)),
        )

        s1, s2, s3 = st.columns(3)
        s1p = s1.slider(
            "Scope 1 reduction by Interim (%)",
            0,
            100,
            int(coalesce(c.get("interim_s1_pct"), 50)),
        )
        s2p = s2.slider(
            "Scope 2 reduction by Interim (%)",
            0,
            100,
            int(coalesce(c.get("interim_s2_pct"), 50)),
        )
        s3p = s3.slider(
            "Scope 3 reduction by Interim (%)",
            0,
            100,
            int(coalesce(c.get("interim_s3_pct"), 50)),
        )

        if st.button("Save Targets"):
            with get_conn() as con:
                con.execute(
                    "UPDATE clients SET net_zero_year=?, interim_year=?, interim_s1_pct=?, interim_s2_pct=?, interim_s3_pct=? WHERE db_id=?",
                    [int(nz_year), int(interim_year), int(s1p), int(s2p), int(s3p), cid]
                )
            st.success("Targets updated.")

        # Baseline year resolution (robust vs pd.NA/None)
        with get_conn() as con:
            bmy = c.get("benchmark_year")

            if is_blank(bmy):
                row = con.execute(
                    "SELECT MIN(reporting_year) FROM crp_reports WHERE client_db_id=?",
                    [cid]
                ).fetchone()
                min_year = row[0] if row else None

                if is_blank(min_year):
                    bmy = int(st.session_state.get("working_year", 2026))
                else:
                    bmy = int(min_year)
            else:
                bmy = int(bmy)

            base = con.execute(
                """
                SELECT scope, SUM(emissions_tco2e) AS t
                FROM activity_data
                WHERE client_db_id=?
                  AND crp_id IN (
                    SELECT crp_id
                    FROM crp_reports
                    WHERE client_db_id=? AND reporting_year=?
                  )
                GROUP BY scope
                """,
                [cid, cid, bmy]
            ).df()

        baseline = {"Scope 1": 0.0, "Scope 2": 0.0, "Scope 3": 0.0}
        if not base.empty:
            for _, r in base.iterrows():
                s = str(r["scope"]).strip().lower()
                if s.startswith("scope 1"):
                    baseline["Scope 1"] = float(coalesce(r["t"], 0.0))
                elif s.startswith("scope 2"):
                    baseline["Scope 2"] = float(coalesce(r["t"], 0.0))
                elif s.startswith("scope 3"):
                    baseline["Scope 3"] = float(coalesce(r["t"], 0.0))

        fdf = build_forecast_df(int(bmy), int(nz_year), int(interim_year), int(s1p), int(s2p), int(s3p), baseline)
        st.caption(f"Baseline year: {bmy}")
        st.plotly_chart(px.area(fdf, x="Year", y=["Scope 1", "Scope 2", "Scope 3"], title="Emissions Forecast to Net Zero"), use_container_width=True)
        table_with_pager(fdf, "Forecast Table", key="forecast_tbl")

    # --------------------
    # ACTIVITY (LIST)
    # --------------------
    with tabs[5]:
        with get_conn() as con:
            df = con.execute(
                """
                SELECT COALESCE(s.site_name,'(Unassigned)') AS site,
                       ad.scope,
                       SUM(ad.emissions_tco2e) AS tCO2e
                FROM activity_data ad
                LEFT JOIN client_sites s ON s.site_id = ad.site_id
                WHERE ad.client_db_id=?
                GROUP BY 1,2
                ORDER BY 1,2
                """,
                [cid]
            ).df()
        table_with_pager(df, "Activity Summary (by Site & Scope)", key="activity_summary")

    # --------------------
    # DATASETS USED (LIST)
    # --------------------
    with tabs[6]:
        st.subheader("Datasets used in client calculations")
        with get_conn() as con:
            df = con.execute(
                """
                SELECT d.name, d.source, d.analysis_type, d.country, d.year, d.version,
                       COUNT(*) AS lines, SUM(ad.emissions_tco2e) AS total_tco2e
                FROM activity_data ad
                JOIN factor_lookup fl ON fl.db_id = ad.factor_id
                LEFT JOIN datasets d ON d.dataset_id = fl.dataset_id
                WHERE ad.client_db_id = ?
                GROUP BY 1,2,3,4,5,6
                ORDER BY d.year DESC, d.name
                """,
                [cid]
            ).df()
        table_with_pager(df, "Datasets Used", key="datasets_used")

    # --------------------
    # NOTES (ADD + LIST)
    # --------------------
    with tabs[7]:
        with st.expander("➕ Add Note", expanded=False):
            with st.form("add_note_form", clear_on_submit=True):
                note_text = st.text_area("Note", height=120, placeholder="Type your note here...")

                if st.form_submit_button("Add Note"):
                    if is_blank(note_text):
                        st.error("Note cannot be blank.")
                    else:
                        author = (
                            st.session_state.get("user_full_name")
                            or st.session_state.get("user_name")
                            or st.session_state.get("user_email")
                            or "(Unknown)"
                        )
                        add_note(int(cid), str(author), str(note_text))

                        st.success("Note added.")
                        st.rerun()

        df = list_notes(int(cid))
        table_with_pager(df, "Notes", key="notes")
