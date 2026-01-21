import streamlit as st
import pandas as pd

from models import clients as m_clients
from core.database import get_conn


def _init_clients_pager():
    st.session_state.setdefault("clients_tbl_psize", 50)
    st.session_state.setdefault("clients_tbl_page", 0)


def _render_clients_pager(n_rows: int):
    _init_clients_pager()
    psize = st.session_state["clients_tbl_psize"]
    page = st.session_state["clients_tbl_page"]
    total_pages = max(1, (n_rows + psize - 1) // psize)

    c1, c2, c3 = st.columns([6, 3, 3])
    with c1:
        st.caption(f"{n_rows:,} rows total")
    with c2:
        new_size = st.selectbox(
            "Rows",
            [50, 100, 150, 200],
            index=[50, 100, 150, 200].index(psize),
            key="clients_tbl_psel",
        )
        if new_size != psize:
            st.session_state["clients_tbl_psize"] = new_size
            st.session_state["clients_tbl_page"] = 0
            psize, page = new_size, 0
            total_pages = max(1, (n_rows + psize - 1) // psize)

    with c3:
        b1, b2, b3 = st.columns([1, 2, 1])
        if b1.button("◀", key="clients_tbl_prev", disabled=(page <= 0)):
            st.session_state["clients_tbl_page"] = max(0, page - 1)
            st.rerun()
        b2.caption(f"Page {page + 1} / {total_pages}")
        if b3.button("▶", key="clients_tbl_next", disabled=(page >= total_pages - 1)):
            st.session_state["clients_tbl_page"] = min(total_pages - 1, page + 1)
            st.rerun()

    # Re-read after any changes
    psize = st.session_state["clients_tbl_psize"]
    page = st.session_state["clients_tbl_page"]
    start = page * psize
    end = start + psize
    return start, end


def _cell_str(v) -> str:
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except Exception:
        pass
    s = str(v).strip()
    return "" if s.lower() in ("nan", "none") else s


def _open_client(cid_i: int):
    st.session_state["selected_client_id"] = int(cid_i)
    st.session_state["edit_mode"] = False
    st.session_state["active_page"] = "Client Folder"


def _edit_client(cid_i: int):
    st.session_state["selected_client_id"] = int(cid_i)
    st.session_state["edit_mode"] = True
    st.session_state["active_page"] = "Client Folder"


def _archive_client(cid_i: int):
    m_clients.archive_client(int(cid_i))
    st.session_state["active_page"] = "Clients"
    if "nav_page" in st.session_state:
        st.session_state["nav_page"] = "Clients"


def _list_industries():
    """
    Reads industries from industries_lookup (active only).
    If the table doesn't exist yet, returns [] safely.
    """
    try:
        with get_conn() as con:
            df = con.execute(
                "SELECT name FROM industries_lookup WHERE is_active=TRUE ORDER BY name"
            ).df()
        return df["name"].tolist() if not df.empty else []
    except Exception:
        return []


def _clients_table_buttons(df: pd.DataFrame):
    cols = ["client_name", "portfolio", "crm_owner", "industry", "addr_city", "addr_country", "db_id"]
    for c in cols:
        if c not in df.columns:
            df[c] = ""

    h = st.columns([3.0, 1.2, 1.2, 1.6, 1.2, 1.2, 1.0])
    h[0].markdown("**Client**")
    h[1].markdown("**Portfolio**")
    h[2].markdown("**CRM**")
    h[3].markdown("**Industry**")
    h[4].markdown("**City**")
    h[5].markdown("**Country**")
    h[6].markdown("**Actions**")
    st.divider()

    for _, r in df.iterrows():
        cid = r.get("db_id")
        try:
            cid_i = int(cid)
        except Exception:
            cid_i = None

        c = st.columns([3.0, 1.2, 1.2, 1.6, 1.2, 1.2, 1.0])
        c[0].write(_cell_str(r.get("client_name")))
        c[1].write(_cell_str(r.get("portfolio")))
        c[2].write(_cell_str(r.get("crm_owner")))
        c[3].write(_cell_str(r.get("industry")))
        c[4].write(_cell_str(r.get("addr_city")))
        c[5].write(_cell_str(r.get("addr_country")))

        a1, a2, a3 = c[6].columns([1, 1, 1])
        disabled = (cid_i is None)

        a1.button(
            "📂",
            key=f"cl_open_{cid_i}",
            help="Open folder",
            disabled=disabled,
            on_click=_open_client if not disabled else None,
            args=(cid_i,) if not disabled else None,
        )
        a2.button(
            "✏️",
            key=f"cl_edit_{cid_i}",
            help="Edit profile",
            disabled=disabled,
            on_click=_edit_client if not disabled else None,
            args=(cid_i,) if not disabled else None,
        )
        a3.button(
            "🗄️",
            key=f"cl_arch_{cid_i}",
            help="Archive client",
            disabled=disabled,
            on_click=_archive_client if not disabled else None,
            args=(cid_i,) if not disabled else None,
        )

        st.markdown(
            "<div style='height:1px;background:rgba(120,120,120,0.15);margin:6px 0 6px 0;'></div>",
            unsafe_allow_html=True,
        )


def render():
    st.title("👥 Clients")
    search = st.text_input("Search Clients")
    df = m_clients.list_clients(search)

    start, end = _render_clients_pager(len(df))
    df_slice = df.iloc[start:end].copy() if not df.empty else df

    if df_slice.empty:
        st.info("No clients found.")
    else:
        _clients_table_buttons(df_slice)

    with st.expander("➕ New Client"):
        crm_owners = m_clients.list_crm_owners()
        portfolios = m_clients.list_portfolios()
        industries = _list_industries()

        with st.form("new_client_form", clear_on_submit=True):
            c1, c2, c3 = st.columns(3)
            new_n = c1.text_input("Client Name *")
            portfolio = c2.selectbox(
                "Portfolio",
                portfolios,
                index=portfolios.index("NZI") if "NZI" in portfolios else 0,
            )
            crm_owner = c3.selectbox("CRM Owner", crm_owners, index=0)

            c1, c2, c3 = st.columns(3)
            new_w = c1.text_input("Website")

            # Industry dropdown (from lookup) with safe fallback
            if industries:
                new_ind = c2.selectbox("Industry", [""] + industries, index=0)
                other_ind = c3.text_input("Company Reg")
            else:
                new_ind = c2.text_input("Industry")
                other_ind = c3.text_input("Company Reg")

            new_reg = other_ind

            c1, c2, c3 = st.columns(3)
            new_hq = c1.text_input("Headquarters")
            fy_end = c2.selectbox(
                "Financial Year End (Month)",
                ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                index=0,
            )
            logo = c3.text_input("Logo URL")

            st.markdown("**Address**")
            a1, a2 = st.columns(2)
            addr1 = a1.text_input("Address line 1")
            addr2 = a2.text_input("Address line 2")
            pc1, pc2 = st.columns(2)
            city = pc1.text_input("City")
            region = pc2.text_input("Region/State")
            pc1, pc2 = st.columns(2)
            postcode = pc1.text_input("Postcode/ZIP")
            country = pc2.text_input("Country")
            new_desc = st.text_area("Company Description (Long)", value="", height=120)

            st.markdown("**Targets**")
            t1, t2, t3 = st.columns(3)
            net_zero_year = t1.number_input("Net Zero Target Year", min_value=2025, max_value=2100, value=2050)
            target_s1_year = t2.number_input("Scope 1 Target Year", min_value=2025, max_value=2100, value=2050)
            target_s1_pct = t3.number_input("Scope 1 Target Reduction (%)", min_value=0, max_value=100, value=90)

            t1, t2, t3 = st.columns(3)
            target_s2_year = t1.number_input("Scope 2 Target Year", min_value=2025, max_value=2100, value=2050)
            target_s2_pct = t2.number_input("Scope 2 Target Reduction (%)", min_value=0, max_value=100, value=90)
            target_s3_year = t3.number_input("Scope 3 Target Year", min_value=2025, max_value=2100, value=2050)

            t1, _ = st.columns(2)
            target_s3_pct = t1.number_input("Scope 3 Target Reduction (%)", min_value=0, max_value=100, value=90)

            specify_benchmark = st.checkbox("Set Benchmark Year", value=False)
            benchmark_year = None
            if specify_benchmark:
                benchmark_year = st.number_input("Benchmark Year", min_value=1900, max_value=2100, value=2024)

            if st.form_submit_button("Create Client"):
                if not new_n:
                    st.error("Client Name is required.")
                else:
                    payload = dict(
                        client_name=new_n,
                        industry=(new_ind or None),
                        description_long=new_desc or None,
                        website=new_w or None,
                        year_end_month=fy_end or None,
                        company_reg=new_reg or None,
                        headquarters=new_hq or None,
                        addr_line1=addr1 or None,
                        addr_line2=addr2 or None,
                        addr_city=city or None,
                        addr_region=region or None,
                        addr_postcode=postcode or None,
                        addr_country=country or None,
                        logo_url=logo or None,
                        crm_owner=(None if crm_owner == "(Unassigned)" else crm_owner),
                        portfolio=portfolio or "NZI",
                        net_zero_year=int(net_zero_year),

                        # Interim defaults (as per your standard)
                        interim_year=2035,
                        interim_s1_pct=50,
                        interim_s2_pct=50,
                        interim_s3_pct=50,

                        target_s1_year=int(target_s1_year),
                        target_s2_year=int(target_s2_year),
                        target_s3_year=int(target_s3_year),
                        target_s1_pct=int(target_s1_pct),
                        target_s2_pct=int(target_s2_pct),
                        target_s3_pct=int(target_s3_pct),
                    )

                    if benchmark_year is not None:
                        payload["benchmark_year"] = int(benchmark_year)

                    m_clients.create_client(payload)
                    st.success(f"Client {new_n} created.")
                    st.rerun()
