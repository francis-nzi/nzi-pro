import streamlit as st
import plotly.express as px
import pandas as pd

from models.clients import get_client, update_client, list_crm_owners, list_portfolios, list_industries
from components.tables import table_with_pager
from core.database import get_conn, db_backend
from utils.forecasting import build_forecast_df

# Phase 1 service extraction (MCP-ready): keep DB ops out of Streamlit pages
from services.sites import add_site, list_sites
from services.contacts import add_contact, list_contacts
from services.notes import add_note, list_notes
from services.quotes import (
    accept_quote_create_job,
    compute_totals,
    create_quote,
    get_quote,
    list_quotes,
    replace_quote_lines,
    revise_quote,
    update_quote,
)


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


def _parse_ddmmyyyy(label: str, s: str):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return pd.to_datetime(s, format="%d/%m/%Y").date()
    except Exception:
        raise ValueError(f"{label} must be DD/MM/YYYY")


def _fmt_money(amount, symbol: str) -> str:
    try:
        if amount is None:
            return f"{symbol}0.00"
        if pd.isna(amount):
            return f"{symbol}0.00"
    except Exception:
        pass
    try:
        return f"{symbol}{float(amount):,.2f}"
    except Exception:
        return f"{symbol}0.00"


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
                industry_opts = list_industries()
                industry_default = coalesce(c.get("industry"), "")
                if industry_opts:
                    ind_values = [""] + industry_opts
                    ind_idx = ind_values.index(industry_default) if industry_default in ind_values else 0
                    industry = d1.selectbox("Industry", ind_values, index=ind_idx)
                else:
                    industry = d1.text_input("Industry", value=industry_default)
                company_reg = d2.text_input("Company Reg", value=coalesce(c.get("company_reg"), ""))

                e1, e2 = st.columns(2)
                headquarters = e1.text_input("Headquarters", value=coalesce(c.get("headquarters"), ""))
                logo_url = e2.text_input("Logo URL", value=coalesce(c.get("logo_url"), ""))

                st.markdown("**Address**")
                a1, a2 = st.columns(2)
                addr1 = a1.text_input("Address line 1", value=coalesce(c.get("addr_line1"), ""))
                addr2 = a2.text_input("Address line 2", value=coalesce(c.get("addr_line2"), ""))
                pc1, pc2 = st.columns(2)
                city = pc1.text_input("City", value=coalesce(c.get("addr_city"), ""))
                region = pc2.text_input("Region/State", value=coalesce(c.get("addr_region"), ""))
                pc1, pc2 = st.columns(2)
                postcode = pc1.text_input("Postcode/ZIP", value=coalesce(c.get("addr_postcode"), ""))
                country = pc2.text_input("Country", value=coalesce(c.get("addr_country"), ""))

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
                            "addr_line1": addr1 or None,
                            "addr_line2": addr2 or None,
                            "addr_city": city or None,
                            "addr_region": region or None,
                            "addr_postcode": postcode or None,
                            "addr_country": country or None,
                            "logo_url": logo_url or None,
                            "description_long": desc or None,
                            "crm_owner": (None if crm_owner == "(Unassigned)" else crm_owner),
                            "portfolio": portfolio or "NZI",
                            "year_end_month": (year_end_month or None),
                        }
                        update_client(int(cid), payload)
                        st.success("Client profile updated.")
                        _stop_edit()

    tabs = st.tabs([
        "🏢 Profile",
        "📍 Sites",
        "👥 Contacts",
        "🗂️ Jobs",
        "🧾 Reports",
        "🎯 Targets",
        "📊 Activity",
        "🗃️ Datasets Used",
        "💬 Quotes",
        "💷 Invoices",
        "📝 Notes",
    ])

    def _table_exists(table: str) -> bool:
        try:
            with get_conn() as con:
                if db_backend() == "postgres":
                    r = con.execute("SELECT to_regclass(%s)", [f"public.{table}"]).fetchone()
                    return bool(r and r[0])
                con.execute(f"SELECT 1 FROM {table} LIMIT 1")
            return True
        except Exception:
            return False

    with tabs[0]:
        left, right = st.columns([2, 1])
        left.subheader("Client")
        left.write(f"Name: {coalesce(c.get('client_name'), '-')}")
        left.write(f"Portfolio: {coalesce(c.get('portfolio'), '-')}")
        left.write(f"Industry: {coalesce(c.get('industry'), '-')}")
        left.write(f"CRM Owner: {coalesce(c.get('crm_owner'), '-')}")
        right.subheader("Address")
        right.write(coalesce(c.get("addr_line1"), "-"))
        right.write(coalesce(c.get("addr_line2"), ""))
        right.write(f"{coalesce(c.get('addr_city'), '-')}, {coalesce(c.get('addr_region'), '')}")
        right.write(coalesce(c.get("addr_postcode"), ""))
        right.write(coalesce(c.get("addr_country"), "-"))

    # --------------------
    # SITES (ADD + LIST)
    # --------------------
    with tabs[1]:
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
    with tabs[2]:
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
    with tabs[3]:
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
    with tabs[4]:
        if _table_exists("crp_reports"):
            with get_conn() as con:
                df = con.execute(
                    "SELECT reporting_year, is_benchmark, status, created_at FROM crp_reports WHERE client_db_id=? ORDER BY reporting_year",
                    [cid],
                ).df()
            table_with_pager(df, "CRP Years", key="crp_years")
        else:
            with get_conn() as con:
                df = con.execute(
                    """
                    SELECT j.reporting_year,
                           COALESCE(cjd.is_benchmark, FALSE) AS is_benchmark,
                           j.status,
                           j.created_at
                    FROM jobs j
                    LEFT JOIN crp_job_details cjd ON cjd.job_id = j.job_id
                    WHERE j.client_db_id=?
                    ORDER BY j.reporting_year
                    """,
                    [cid],
                ).df()
            table_with_pager(df, "CRP Years", key="crp_years")

    # --------------------
    # TARGETS (EDIT + CHART)
    # --------------------
    with tabs[5]:
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
                try:
                    if db_backend() == "postgres":
                        row = con.execute(
                            "SELECT MIN(reporting_year) FROM jobs WHERE client_db_id=%s",
                            [cid],
                        ).fetchone()
                    else:
                        row = con.execute(
                            "SELECT MIN(reporting_year) FROM crp_reports WHERE client_db_id=?",
                            [cid],
                        ).fetchone()
                    min_year = row[0] if row else None
                except Exception:
                    min_year = None

                if is_blank(min_year):
                    bmy = int(st.session_state.get("working_year", 2026))
                else:
                    bmy = int(min_year)
            else:
                bmy = int(bmy)

            try:
                if db_backend() != "postgres":
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
                        [cid, cid, bmy],
                    ).df()
                else:
                    base = pd.DataFrame()
            except Exception:
                base = pd.DataFrame()

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
    with tabs[6]:
        if not _table_exists("activity_data"):
            st.info("Activity data is not available in this database yet.")
        else:
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
    with tabs[7]:
        st.subheader("Datasets used in client calculations")
        if not _table_exists("activity_data"):
            st.info("Activity data is not available in this database yet.")
        else:
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
    with tabs[8]:
        st.subheader("Quotes")

        try:
            qdf = list_quotes(int(cid))
        except Exception as e:
            st.error(f"Quotes table is not available yet. Apply sql_migrations/0004_quotes.sql. ({e})")
            qdf = pd.DataFrame()

        if "selected_quote_id" not in st.session_state:
            st.session_state["selected_quote_id"] = None

        with st.container():
            st.markdown("**Select quote**")
            s1, s2 = st.columns([3, 2])

            with s1:
                if qdf is None or qdf.empty:
                    st.info("No quotes yet.")
                else:
                    labels = []
                    ids = []
                    for _, r in qdf.iterrows():
                        qid = int(r.get("quote_id"))
                        status = str(r.get("status") or "").strip() or "Draft"
                        qdate = r.get("quote_date")
                        try:
                            qdate = pd.to_datetime(qdate).strftime("%d/%m/%Y") if qdate else ""
                        except Exception:
                            qdate = str(qdate or "")
                        labels.append(f"No. {qid} — {qdate} — {status}")
                        ids.append(qid)
                    cur = st.session_state.get("selected_quote_id")
                    idx = ids.index(cur) if cur in ids else 0
                    picked = st.selectbox("Quote", labels, index=idx)
                    st.session_state["selected_quote_id"] = ids[labels.index(picked)]

            with s2:
                with st.expander("➕ Add Quote", expanded=False):
                    contacts_df = list_contacts(int(cid))
                    contact_opts = ["(None)"]
                    contact_map = {"(None)": None}
                    if contacts_df is not None and not contacts_df.empty:
                        for _, r in contacts_df.iterrows():
                            label = f"{r.get('full_name')}".strip()
                            contact_opts.append(label)
                            contact_map[label] = int(r.get("contact_id"))

                    with get_conn() as con:
                        staff_df = con.execute(
                            "SELECT full_name FROM users WHERE status='Active' AND full_name IS NOT NULL ORDER BY full_name"
                        ).df()
                        pt_df = con.execute(
                            "SELECT term_id, name FROM payment_terms_lookup WHERE is_active=TRUE ORDER BY term_id"
                        ).df()
                        try:
                            cur_df = con.execute(
                                "SELECT currency_code, symbol FROM currencies_lookup WHERE is_active=TRUE ORDER BY currency_code"
                            ).df()
                        except Exception:
                            cur_df = pd.DataFrame()

                    staff_opts = ["(None)"] + (
                        staff_df["full_name"].tolist() if staff_df is not None and not staff_df.empty else []
                    )
                    pt_opts = []
                    pt_map = {}
                    if pt_df is not None and not pt_df.empty:
                        for _, r in pt_df.iterrows():
                            label = str(r.get("name"))
                            pt_opts.append(label)
                            pt_map[label] = int(r.get("term_id"))
                    if not pt_opts:
                        pt_opts = ["100% in advance"]
                        pt_map["100% in advance"] = 1

                    cur_opts = ["GBP"]
                    if cur_df is not None and not cur_df.empty and "currency_code" in cur_df.columns:
                        cur_opts = cur_df["currency_code"].astype(str).tolist()

                    c1, c2 = st.columns(2)
                    contact_label = c1.selectbox("Contact", contact_opts, index=0)
                    salesperson = c2.selectbox("Sales person", staff_opts, index=0)

                    d1, d2 = st.columns(2)
                    quote_date_txt = d1.text_input("Quote date (DD/MM/YYYY)", value=pd.Timestamp.today().strftime("%d/%m/%Y"))
                    valid_to_txt = d2.text_input(
                        "Valid to (DD/MM/YYYY)",
                        value=(pd.Timestamp.today() + pd.Timedelta(days=30)).strftime("%d/%m/%Y"),
                    )

                    payment_terms = st.selectbox("Payment terms", pt_opts, index=0)
                    currency_code = st.selectbox(
                        "Currency",
                        cur_opts,
                        index=(cur_opts.index("GBP") if "GBP" in cur_opts else 0),
                    )
                    desc = st.text_area("Description (above lines)", height=80)
                    notes = st.text_area("Notes", height=100)

                    if st.button("Create Quote"):
                        try:
                            quote_date = _parse_ddmmyyyy("Quote date", quote_date_txt)
                            valid_to = _parse_ddmmyyyy("Valid to", valid_to_txt)
                            if not quote_date:
                                raise ValueError("Quote date is required.")
                            if not valid_to:
                                raise ValueError("Valid to is required.")
                        except ValueError as e:
                            st.error(str(e))
                            st.stop()

                        new_id = create_quote(
                            client_db_id=int(cid),
                            contact_id=contact_map.get(contact_label),
                            quote_date=quote_date,
                            valid_to=valid_to,
                            salesperson=(None if salesperson == "(None)" else salesperson),
                            payment_term_id=pt_map.get(payment_terms),
                            currency_code=currency_code,
                            description=desc,
                            notes=notes,
                        )
                        st.session_state["selected_quote_id"] = int(new_id)
                        st.success(f"Quote No. {int(new_id)} created.")
                        st.rerun()

        st.markdown("---")
        with st.container():
            qid = st.session_state.get("selected_quote_id")
            if not qid:
                st.info("Select a quote to view/edit.")
            else:
                q = get_quote(int(qid))
                if not q:
                    st.warning("Quote not found.")
                else:
                    status = str(q.get("status") or "Draft")
                    currency_code = str(q.get("currency_code") or "GBP").strip().upper() or "GBP"

                    with get_conn() as con:
                        try:
                            cur_map_df = con.execute(
                                "SELECT currency_code, symbol FROM currencies_lookup WHERE is_active=TRUE"
                            ).df()
                        except Exception:
                            cur_map_df = pd.DataFrame()

                    symbol = "£"
                    if cur_map_df is not None and not cur_map_df.empty:
                        try:
                            m = cur_map_df.loc[cur_map_df["currency_code"].astype(str) == currency_code]
                            if not m.empty:
                                symbol = str(m.iloc[0].get("symbol") or symbol)
                        except Exception:
                            pass

                    qd_show = ""
                    try:
                        qd_show = pd.to_datetime(q.get("quote_date")).strftime("%d/%m/%Y")
                    except Exception:
                        qd_show = str(q.get("quote_date") or "")

                    st.markdown(f"**Quote No. {int(qid)}** — {qd_show} — Status: **{status}** — **{currency_code}**")

                    with st.form(f"quote_header_{int(qid)}"):
                        contacts_df = list_contacts(int(cid))
                        contact_opts = ["(None)"]
                        contact_map = {"(None)": None}
                        rev_contact_map = {None: "(None)"}
                        if contacts_df is not None and not contacts_df.empty:
                            for _, r in contacts_df.iterrows():
                                label = f"{r.get('full_name')}".strip()
                                contact_opts.append(label)
                                contact_map[label] = int(r.get("contact_id"))
                                rev_contact_map[int(r.get("contact_id"))] = label

                        with get_conn() as con:
                            staff_df = con.execute(
                                "SELECT full_name FROM users WHERE status='Active' AND full_name IS NOT NULL ORDER BY full_name"
                            ).df()
                            pt_df = con.execute(
                                "SELECT term_id, name FROM payment_terms_lookup WHERE is_active=TRUE ORDER BY term_id"
                            ).df()
                            try:
                                cur_df = con.execute(
                                    "SELECT currency_code FROM currencies_lookup WHERE is_active=TRUE ORDER BY currency_code"
                                ).df()
                            except Exception:
                                cur_df = pd.DataFrame()

                        staff_opts = ["(None)"] + (staff_df["full_name"].tolist() if staff_df is not None and not staff_df.empty else [])
                        pt_opts = []
                        pt_map = {}
                        rev_pt_map = {}
                        if pt_df is not None and not pt_df.empty:
                            for _, r in pt_df.iterrows():
                                label = str(r.get("name"))
                                pt_opts.append(label)
                                pt_map[label] = int(r.get("term_id"))
                                rev_pt_map[int(r.get("term_id"))] = label

                        c1, c2 = st.columns(2)
                        contact_default = rev_contact_map.get(q.get("contact_id"), "(None)")
                        c_idx = contact_opts.index(contact_default) if contact_default in contact_opts else 0
                        contact_label = c1.selectbox("Contact", contact_opts, index=c_idx)

                        salesperson_default = str(q.get("salesperson") or "(None)")
                        s_idx = staff_opts.index(salesperson_default) if salesperson_default in staff_opts else 0
                        salesperson = c2.selectbox("Sales person", staff_opts, index=s_idx)

                        d1, d2 = st.columns(2)
                        qd_val = pd.to_datetime(q.get("quote_date") or pd.Timestamp.today()).date()
                        vt_val = pd.to_datetime(q.get("valid_to") or (pd.Timestamp.today() + pd.Timedelta(days=30))).date()
                        quote_date_txt = d1.text_input("Quote date (DD/MM/YYYY)", value=pd.Timestamp(qd_val).strftime("%d/%m/%Y"))
                        valid_to_txt = d2.text_input("Valid to (DD/MM/YYYY)", value=pd.Timestamp(vt_val).strftime("%d/%m/%Y"))

                        pt_default = rev_pt_map.get(q.get("payment_term_id"), (pt_opts[0] if pt_opts else ""))
                        pt_idx = pt_opts.index(pt_default) if pt_default in pt_opts else 0
                        payment_terms = st.selectbox("Payment terms", pt_opts, index=pt_idx) if pt_opts else ""

                        cur_opts = ["GBP"]
                        if cur_df is not None and not cur_df.empty and "currency_code" in cur_df.columns:
                            cur_opts = cur_df["currency_code"].astype(str).tolist()
                        cur_default = str(q.get("currency_code") or "GBP").strip().upper() or "GBP"
                        cur_idx = cur_opts.index(cur_default) if cur_default in cur_opts else 0
                        currency_code = st.selectbox("Currency", cur_opts, index=cur_idx)

                        desc = st.text_area("Description (above lines)", value=str(q.get("description") or ""), height=80)
                        notes = st.text_area("Notes", value=str(q.get("notes") or ""), height=100)

                        save = st.form_submit_button("Save Header")
                        if save:
                            try:
                                quote_date = _parse_ddmmyyyy("Quote date", quote_date_txt)
                                valid_to = _parse_ddmmyyyy("Valid to", valid_to_txt)
                                if not quote_date:
                                    raise ValueError("Quote date is required.")
                                if not valid_to:
                                    raise ValueError("Valid to is required.")
                            except ValueError as e:
                                st.error(str(e))
                                st.stop()

                            update_quote(
                                int(qid),
                                {
                                    "contact_id": contact_map.get(contact_label),
                                    "salesperson": (None if salesperson == "(None)" else salesperson),
                                    "quote_date": quote_date,
                                    "valid_to": valid_to,
                                    "payment_term_id": pt_map.get(payment_terms) if payment_terms else None,
                                    "currency_code": currency_code,
                                    "description": desc,
                                    "notes": notes,
                                },
                            )
                            st.success("Saved.")
                            st.rerun()

                    with get_conn() as con:
                        jt = con.execute(
                            """
                            SELECT job_type_id, name, description, unit_price_ex_vat, vat_rate_id
                            FROM job_types
                            WHERE is_active=TRUE
                            ORDER BY name
                            """
                        ).df()
                        vr = con.execute(
                            """
                            SELECT vat_rate_id, name, rate_pct
                            FROM vat_rates_lookup
                            WHERE is_active=TRUE
                            ORDER BY is_default DESC, name
                            """
                        ).df()

                    jt_opts = ["(Custom)"]
                    jt_map = {"(Custom)": None}
                    jt_defaults = {}
                    if jt is not None and not jt.empty:
                        for _, r in jt.iterrows():
                            label = str(r.get("name"))
                            jt_opts.append(label)
                            jt_map[label] = int(r.get("job_type_id"))
                            jt_defaults[int(r.get("job_type_id"))] = {
                                "description": r.get("description"),
                                "unit_price_ex_vat": r.get("unit_price_ex_vat"),
                                "vat_rate_id": r.get("vat_rate_id"),
                            }

                    vat_opts = ["(None)"]
                    vat_map = {"(None)": None}
                    rev_vat_map = {None: "(None)"}
                    if vr is not None and not vr.empty:
                        for _, r in vr.iterrows():
                            vid = int(r.get("vat_rate_id"))
                            label = f"{float(r.get('rate_pct') or 0):g}%"
                            vat_opts.append(label)
                            vat_map[label] = vid
                            rev_vat_map[vid] = label

                    lines_df = q.get("lines")
                    if lines_df is None or lines_df.empty:
                        lines_df = pd.DataFrame(
                            [
                                {
                                    "line_type": "Line",
                                    "job_type": "(Custom)",
                                    "description": "",
                                    "qty": 1.0,
                                    "unit_price_ex_vat": 0.0,
                                    "vat_rate": vat_opts[0],
                                    "is_selected": True,
                                    "delete": False,
                                    "line_total": 0.0,
                                }
                            ]
                        )
                    else:
                        def _jt_label(job_type_id):
                            if job_type_id is None:
                                return "(Custom)"
                            try:
                                rid = int(job_type_id)
                                if jt is not None and not jt.empty:
                                    m = jt.loc[jt["job_type_id"] == rid]
                                    if not m.empty:
                                        return str(m.iloc[0]["name"])
                            except Exception:
                                pass
                            return "(Custom)"

                        def _vat_label(vat_rate_id):
                            try:
                                return rev_vat_map.get(int(vat_rate_id), "(None)")
                            except Exception:
                                return "(None)"

                        rows = []
                        for _, r in lines_df.iterrows():
                            lt_val = float(r.get("qty") or 0) * float(r.get("unit_price_ex_vat") or 0)
                            rows.append(
                                {
                                    "line_type": str(r.get("line_type") or "Line"),
                                    "job_type": _jt_label(r.get("job_type_id")),
                                    "description": str(r.get("description") or ""),
                                    "qty": float(r.get("qty") or 0),
                                    "unit_price_ex_vat": float(r.get("unit_price_ex_vat") or 0),
                                    "vat_rate": _vat_label(r.get("vat_rate_id")),
                                    "is_selected": bool(r.get("is_selected") if r.get("is_selected") is not None else True),
                                    "delete": False,
                                    "line_total": lt_val,
                                }
                            )
                        lines_df = pd.DataFrame(rows)

                    def _apply_quote_line_defaults(df_in: pd.DataFrame) -> pd.DataFrame:
                        if df_in is None or df_in.empty:
                            return df_in
                        df = df_in.copy()

                        if "qty" not in df.columns:
                            df["qty"] = 1.0
                        df["qty"] = df["qty"].fillna(1.0)
                        df.loc[df["qty"] == 0, "qty"] = 1.0

                        if "unit_price_ex_vat" not in df.columns:
                            df["unit_price_ex_vat"] = 0.0
                        df["unit_price_ex_vat"] = df["unit_price_ex_vat"].fillna(0.0)

                        if "job_type" not in df.columns:
                            df["job_type"] = "(Custom)"
                        if "description" not in df.columns:
                            df["description"] = ""
                        if "vat_rate" not in df.columns:
                            df["vat_rate"] = "(None)"

                        if "delete" not in df.columns:
                            df["delete"] = False

                        for i, r in df.iterrows():
                            jt_label = r.get("job_type")
                            jt_id = jt_map.get(jt_label)
                            defaults = jt_defaults.get(jt_id) if jt_id is not None else None
                            if jt_id is not None and defaults:
                                if is_blank(r.get("description")):
                                    df.at[i, "description"] = str(defaults.get("description") or "")
                                try:
                                    if float(r.get("unit_price_ex_vat") or 0) == 0 and defaults.get("unit_price_ex_vat") is not None:
                                        df.at[i, "unit_price_ex_vat"] = float(defaults.get("unit_price_ex_vat") or 0)
                                except Exception:
                                    pass
                                try:
                                    if (is_blank(r.get("vat_rate")) or r.get("vat_rate") == "(None)") and defaults.get("vat_rate_id") is not None:
                                        df.at[i, "vat_rate"] = rev_vat_map.get(int(defaults.get("vat_rate_id")), "(None)")
                                except Exception:
                                    pass

                        df["line_total"] = (df["qty"].astype(float) * df["unit_price_ex_vat"].astype(float)).fillna(0.0)
                        return df

                    editor_key = f"quote_lines_editor_{int(qid)}"
                    edited_prev = st.session_state.get(editor_key)
                    if isinstance(edited_prev, pd.DataFrame) and not edited_prev.empty:
                        try:
                            prev_job_types = edited_prev.get("job_type")
                            cur_job_types = lines_df.get("job_type")
                            if prev_job_types is not None and cur_job_types is not None:
                                changed = (prev_job_types.astype(str) != cur_job_types.astype(str))
                                if bool(changed.any()):
                                    for ix in list(lines_df.index[changed]):
                                        jt_label = lines_df.at[ix, "job_type"]
                                        jt_id = jt_map.get(jt_label)
                                        defaults = jt_defaults.get(jt_id) if jt_id is not None else None
                                        if jt_id is not None and defaults:
                                            lines_df.at[ix, "description"] = str(defaults.get("description") or "")
                                            try:
                                                lines_df.at[ix, "unit_price_ex_vat"] = float(defaults.get("unit_price_ex_vat") or 0)
                                            except Exception:
                                                pass
                                            try:
                                                lines_df.at[ix, "vat_rate"] = rev_vat_map.get(int(defaults.get("vat_rate_id")), "(None)")
                                            except Exception:
                                                pass
                                            if float(lines_df.at[ix, "qty"] or 0) == 0:
                                                lines_df.at[ix, "qty"] = 1.0
                        except Exception:
                            pass

                    lines_df = _apply_quote_line_defaults(lines_df)

                    try:
                        st.markdown(
                            """
                            <style>
                            div[data-testid="stDataEditor"] * { font-size: 0.92rem; }
                            div[data-testid="stDataEditor"] [role="gridcell"] { white-space: normal !important; line-height: 1.25 !important; }
                            </style>
                            """,
                            unsafe_allow_html=True,
                        )
                    except Exception:
                        pass

                    def _recalc_lines() -> None:
                        try:
                            cur = st.session_state.get(editor_key)
                            if isinstance(cur, pd.DataFrame) and not cur.empty:
                                cur2 = _apply_quote_line_defaults(cur)
                                try:
                                    if "delete" in cur2.columns and bool(cur2["delete"].fillna(False).astype(bool).any()):
                                        cur2 = cur2.loc[~cur2["delete"].fillna(False).astype(bool)].copy()
                                        cur2["delete"] = False
                                except Exception:
                                    pass
                                st.session_state[editor_key] = cur2
                        except Exception:
                            pass

                    st.markdown("**Quote lines**")

                    try:
                        lines_df = lines_df[[
                            "line_type",
                            "job_type",
                            "description",
                            "qty",
                            "unit_price_ex_vat",
                            "vat_rate",
                            "line_total",
                            "is_selected",
                            "delete",
                        ]]
                    except Exception:
                        pass

                    edited = st.data_editor(
                        lines_df,
                        use_container_width=True,
                        num_rows="dynamic",
                        column_config={
                            "line_type": st.column_config.SelectboxColumn("Type", options=["Line", "Option"]),
                            "job_type": st.column_config.SelectboxColumn("Item", options=jt_opts, width="medium"),
                            "description": st.column_config.TextColumn("Description", width="medium"),
                            "vat_rate": st.column_config.SelectboxColumn("VAT", options=vat_opts),
                            "qty": st.column_config.NumberColumn("Qty", min_value=0.0, step=1.0, format="%.0f"),
                            "unit_price_ex_vat": st.column_config.NumberColumn(
                                "Unit price",
                                min_value=0.0,
                                step=0.01,
                                format="%.2f",
                                width="small",
                            ),
                            "line_total": st.column_config.NumberColumn(
                                "Total (ex VAT)",
                                min_value=0.0,
                                step=0.01,
                                format="%.2f",
                                help="Qty × Unit price (ex VAT)",
                                width="small",
                            ),
                            "is_selected": st.column_config.CheckboxColumn("Include", help="Only used for Option lines"),
                            "delete": st.column_config.CheckboxColumn("🗑", width="small"),
                        },
                        disabled=["line_total"],
                        key=editor_key,
                        on_change=_recalc_lines,
                    )

                    edited = _apply_quote_line_defaults(edited)

                    if st.button("Save Lines", key=f"save_lines_{int(qid)}"):
                        out = []
                        for _, r in edited.iterrows():
                            if bool(r.get("delete")):
                                continue
                            jt_id = jt_map.get(r.get("job_type"))
                            defaults = jt_defaults.get(jt_id) if jt_id is not None else None
                            desc2 = str(r.get("description") or "").strip() or None
                            if (jt_id is not None) and (desc2 is None) and defaults:
                                desc2 = (defaults.get("description") or None)
                            qty = float(r.get("qty") or 0)
                            if qty == 0:
                                qty = 1.0

                            unit = float(r.get("unit_price_ex_vat") or 0)
                            if (jt_id is not None) and (unit == 0) and defaults and defaults.get("unit_price_ex_vat") is not None:
                                try:
                                    unit = float(defaults.get("unit_price_ex_vat") or 0)
                                except Exception:
                                    pass
                            vat_id = vat_map.get(r.get("vat_rate"))
                            if (jt_id is not None) and (vat_id is None) and defaults and defaults.get("vat_rate_id") is not None:
                                try:
                                    vat_id = int(defaults.get("vat_rate_id"))
                                except Exception:
                                    pass

                            out.append(
                                {
                                    "line_type": r.get("line_type"),
                                    "job_type_id": jt_id,
                                    "description": desc2,
                                    "qty": qty,
                                    "unit_price_ex_vat": unit,
                                    "vat_rate_id": vat_id,
                                    "is_selected": bool(r.get("is_selected") if r.get("is_selected") is not None else True),
                                }
                            )
                        replace_quote_lines(int(qid), out)
                        st.success("Lines saved.")
                        st.rerun()

                    # Totals
                    q2 = get_quote(int(qid))
                    totals = compute_totals(q2.get("lines"))
                    t1, t2, t3 = st.columns(3)
                    t1.metric("Sub-total (ex VAT)", _fmt_money(totals.subtotal_ex_vat, symbol))
                    t2.metric("VAT", _fmt_money(totals.vat_total, symbol))
                    t3.metric("Total", _fmt_money(totals.total_inc_vat, symbol))

                    # Status actions
                    a1, a2, a3, a4 = st.columns(4)
                    if a1.button("Issue", disabled=(status not in ("Draft", "Revised")), key=f"issue_{int(qid)}"):
                        update_quote(int(qid), {"status": "Issued"})
                        st.rerun()
                    if a2.button("Accept", disabled=(status not in ("Issued",)), key=f"accept_{int(qid)}"):
                        job_id = accept_quote_create_job(int(qid))
                        st.success(f"Accepted. Created Job ID {int(job_id)}")
                        st.session_state["selected_job_id"] = int(job_id)
                        st.session_state["active_page"] = "Job Folder"
                        st.rerun()
                    if a3.button("Reject", disabled=(status not in ("Issued",)), key=f"reject_{int(qid)}"):
                        update_quote(int(qid), {"status": "Rejected"})
                        st.rerun()
                    if a4.button("Revise", disabled=(status not in ("Issued", "Rejected", "Accepted")), key=f"revise_{int(qid)}"):
                        new_id = revise_quote(int(qid))
                        st.session_state["selected_quote_id"] = int(new_id)
                        st.success(f"Created revision #{int(new_id)}")
                        st.rerun()

    with tabs[9]:
        st.subheader("Invoices")
        st.info("Invoices will be managed from within Jobs. This tab is a placeholder.")

    with tabs[10]:
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
